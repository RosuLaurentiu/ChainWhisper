import { decryptUint } from '@coti-io/coti-sdk-typescript';
import {
  Contract,
  Interface,
  getAddress,
  type JsonRpcSigner,
  type TransactionReceipt,
  type TransactionResponse
} from '@coti-io/coti-ethers';
import {
  assertAttestedDexV2Deployment,
  type AttestedDexV2Deployment
} from './dexV2Chain';
import {
  DEX_V2_ACTION_ABI,
  assertPreparedDexV2ActionCall,
  prepareDexV2ActionCall,
  type DexV2Action,
  type DexV2ActionIntent
} from './dexV2Actions';
import { DEX_V2_POSITION_GAS_LIMIT } from './dexV2PoolExecution';
import {
  DEX_V2_CONFIRMATIONS,
  DEX_V2_RECEIPT_TIMEOUT_MS,
  encryptDexV2Uint64Input
} from './dexV2SwapExecution';
import { readWalletActionIntent } from './walletActionIntent';

const UINT64_MAX = (1n << 64n) - 1n;
const ABI = Object.freeze([
  ...DEX_V2_ACTION_ABI,
  'event DexLimitPositionCreated(uint256 indexed positionId,bytes32 indexed pairKey,address indexed owner,uint56 priorityId)',
  'event DexLimitPositionPauseSet(uint256 indexed positionId,bool paused,uint64 ownerRevision)',
  'event DexLimitPositionClosed(uint256 indexed positionId,address indexed owner,uint64 ownerRevision)',
  'event DexRecurringPositionCreated(uint256 indexed positionId,bytes32 indexed pairKey,address indexed owner,uint56 priorityId)',
  'event DexRecurringPositionPauseSet(uint256 indexed positionId,bool paused,uint64 ownerRevision)',
  'event DexRecurringRanksUpdated(uint256 indexed positionId,uint64 ownerRevision)',
  'event DexRecurringLiquidityAdded(uint256 indexed positionId,uint64 ownerRevision)',
  'event DexRecurringPositionClosed(uint256 indexed positionId,address indexed owner,uint64 ownerRevision)',
  'function getPosition(uint256 positionId) view returns ((uint8 kind,uint8 lifecycle,bytes32 pairKey,address privacyOwner,uint64 createdAt,uint64 ownerRevision,uint56 priorityId,uint8 hiddenSlot) position)',
  'function getLimitOwnerSnapshot(uint256 positionId) returns ((address recipient,uint64 sequence,bool initialized,(uint256 ciphertext,uint256 userCiphertext) primaryLots,(uint256 ciphertext,uint256 userCiphertext) baseClaimOrInventoryLots,(uint256 ciphertext,uint256 userCiphertext) quoteClaimOrInventoryLots) snapshot)',
  'function getRecurringOwnerSnapshot(uint256 positionId) returns ((address recipient,uint64 sequence,bool initialized,(uint256 ciphertext,uint256 userCiphertext) primaryLots,(uint256 ciphertext,uint256 userCiphertext) baseClaimOrInventoryLots,(uint256 ciphertext,uint256 userCiphertext) quoteClaimOrInventoryLots) snapshot)'
] as const);
const CORE = new Interface(ABI);
const NFT_ABI = Object.freeze(['function ownerOf(uint256 tokenId) view returns (address owner)'] as const);

type HiddenActionKind = Exclude<DexV2Action['kind'],
  'create-pool' | 'add-pool' | 'withdraw-pool' | 'withdraw-all-pool' |
  'transfer-position' | 'activate-position-privacy' | 'swap'>;

const LIMIT_KINDS = new Set<HiddenActionKind>([
  'create-limit', 'pause-limit', 'resume-limit', 'close-limit'
]);
const CLOSED_KINDS = new Set<HiddenActionKind>(['close-limit', 'close-recurring']);
const PAUSE_KINDS = new Set<HiddenActionKind>(['pause-limit', 'pause-recurring']);
const RESUME_KINDS = new Set<HiddenActionKind>(['resume-limit', 'resume-recurring']);

const SUBMISSIONS = new WeakMap<object, Readonly<{
  deployment: AttestedDexV2Deployment;
  signer: JsonRpcSigner;
  owner: string;
  kind: HiddenActionKind;
  positionId: bigint | null;
  expectedOwnerRevision: bigint | null;
  initialLifecycle: bigint | null;
}>>();

const uint = (value: unknown, label: string): bigint => {
  try {
    const parsed = BigInt(value as bigint | number | string);
    if (parsed < 0n) throw new Error('negative');
    return parsed;
  } catch {
    throw new Error(`${label} is invalid.`);
  }
};

const address = (value: unknown, label: string): string => {
  try {
    return getAddress(String(value)).toLowerCase();
  } catch {
    throw new Error(`${label} is invalid.`);
  }
};

const bytes32 = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error(`${label} is invalid.`);
  }
  return value.toLowerCase();
};

const tupleField = (value: unknown, name: string, index: number, label: string): unknown => {
  if (!value || typeof value !== 'object') throw new Error(`${label} is malformed.`);
  const tuple = value as Record<string | number, unknown>;
  return tuple[name] ?? tuple[index];
};

const decryptUserUint = (value: unknown, aesKey: string, label: string): bigint => {
  const userCiphertext = uint(tupleField(value, 'userCiphertext', 1, label), `${label} user ciphertext`);
  return uint(decryptUint(userCiphertext, aesKey), `${label} plaintext`);
};

const waitForReceipt = async (
  transaction: TransactionResponse
): Promise<Readonly<{ receipt: TransactionReceipt; transactionHash: string }>> => {
  let receipt: TransactionReceipt | null = null;
  let transactionHash = bytes32(transaction.hash, 'DEX V2 hidden-position transaction hash');
  try {
    receipt = await transaction.wait(DEX_V2_CONFIRMATIONS, DEX_V2_RECEIPT_TIMEOUT_MS);
  } catch (error) {
    const replacement = error as {
      code?: unknown;
      cancelled?: unknown;
      reason?: unknown;
      replacement?: TransactionResponse;
      receipt?: TransactionReceipt;
    };
    if (replacement?.code !== 'TRANSACTION_REPLACED') throw error;
    if (replacement.cancelled === true || replacement.reason === 'cancelled' || !replacement.replacement) {
      throw new Error('The hidden-position transaction replacement was cancelled.');
    }
    transactionHash = bytes32(replacement.replacement.hash, 'DEX V2 hidden-position replacement hash');
    receipt = replacement.receipt ?? await replacement.replacement.wait(
      DEX_V2_CONFIRMATIONS,
      DEX_V2_RECEIPT_TIMEOUT_MS
    );
  }
  if (!receipt || receipt.status !== 1) throw new Error('DEX V2 hidden-position transaction did not succeed.');
  if (bytes32(receipt.hash, 'DEX V2 hidden-position receipt hash') !== transactionHash) {
    throw new Error('DEX V2 hidden-position receipt belongs to another transaction.');
  }
  return Object.freeze({ receipt, transactionHash });
};

const eventFor = (kind: HiddenActionKind): Readonly<{
  name: string;
  mode: 'created' | 'pause' | 'revision' | 'closed';
}> => {
  switch (kind) {
    case 'create-limit': return Object.freeze({ name: 'DexLimitPositionCreated', mode: 'created' });
    case 'pause-limit':
    case 'resume-limit': return Object.freeze({ name: 'DexLimitPositionPauseSet', mode: 'pause' });
    case 'close-limit': return Object.freeze({ name: 'DexLimitPositionClosed', mode: 'closed' });
    case 'create-recurring': return Object.freeze({ name: 'DexRecurringPositionCreated', mode: 'created' });
    case 'update-recurring-ranks': return Object.freeze({ name: 'DexRecurringRanksUpdated', mode: 'revision' });
    case 'add-recurring-liquidity': return Object.freeze({ name: 'DexRecurringLiquidityAdded', mode: 'revision' });
    case 'pause-recurring':
    case 'resume-recurring': return Object.freeze({ name: 'DexRecurringPositionPauseSet', mode: 'pause' });
    case 'close-recurring': return Object.freeze({ name: 'DexRecurringPositionClosed', mode: 'closed' });
  }
};

export type DexV2HiddenSubmission = Readonly<{
  transaction: TransactionResponse;
  submittedTransactionHash: string;
}>;

export type ConfirmedDexV2HiddenAction = Readonly<{
  kind: HiddenActionKind;
  positionId: string;
  ownerRevision: string;
  lifecycle: 'active' | 'paused' | 'closed';
  priorityId: string;
  snapshotSequence: string;
  totalInventoryLots: string;
  baseInventoryLots: string;
  quoteInventoryLots: string;
  transactionHash: string;
  blockNumber: string;
  blockHash: string;
}>;

export type RevealedDexV2HiddenPosition = Readonly<{
  positionId: string;
  kind: 'limit' | 'recurring';
  lifecycle: 'active' | 'paused';
  ownerRevision: string;
  snapshotSequence: string;
  totalInventoryLots: string;
  baseInventoryLots: string;
  quoteInventoryLots: string;
  blockNumber: string;
  blockHash: string;
}>;

export const revealDexV2HiddenPosition = async ({
  deployment,
  positionId,
  kind,
  expectedOwnerRevision,
  signer
}: {
  deployment: AttestedDexV2Deployment;
  positionId: bigint;
  kind: 'limit' | 'recurring';
  expectedOwnerRevision: bigint;
  signer: JsonRpcSigner;
}): Promise<RevealedDexV2HiddenPosition> => {
  const verified = assertAttestedDexV2Deployment(deployment);
  if (positionId <= 0n || expectedOwnerRevision < 0n || expectedOwnerRevision > UINT64_MAX) {
    throw new Error('DEX V2 hidden-position reference is invalid.');
  }
  const owner = address(await signer.getAddress(), 'DEX V2 hidden-position owner');
  const network = await signer.provider.getNetwork();
  if (network.chainId !== BigInt(verified.manifest.chainId)) {
    throw new Error('The selected wallet is not connected to the activated DEX chain.');
  }
  const blockTag = BigInt(verified.attestationBlock.number);
  const core = new Contract(verified.manifest.addresses.core, ABI, signer);
  const position = await core.getPosition.staticCall(positionId, { blockTag });
  const expectedKind = kind === 'limit' ? 2n : 3n;
  const lifecycle = uint(tupleField(position, 'lifecycle', 1, 'DEX V2 hidden position'), 'DEX V2 lifecycle');
  if (
    uint(tupleField(position, 'kind', 0, 'DEX V2 hidden position'), 'DEX V2 position kind') !== expectedKind ||
    (lifecycle !== 1n && lifecycle !== 2n) ||
    bytes32(tupleField(position, 'pairKey', 2, 'DEX V2 hidden position'), 'DEX V2 position pair') !== verified.manifest.pair.pairKey ||
    address(tupleField(position, 'privacyOwner', 3, 'DEX V2 hidden position'), 'DEX V2 privacy owner') !== owner ||
    uint(tupleField(position, 'ownerRevision', 5, 'DEX V2 hidden position'), 'DEX V2 owner revision') !== expectedOwnerRevision
  ) {
    throw new Error('DEX V2 hidden position changed before its private inventory was revealed.');
  }
  const nft = new Contract(verified.manifest.addresses.positionToken, NFT_ABI, signer);
  if (address(await nft.ownerOf.staticCall(positionId, { blockTag }), 'DEX V2 Position NFT owner') !== owner) {
    throw new Error('DEX V2 Position NFT is no longer owned by this wallet.');
  }
  const getter = kind === 'limit' ? 'getLimitOwnerSnapshot' : 'getRecurringOwnerSnapshot';
  const snapshot = await (core[getter] as { staticCall: (...args: unknown[]) => Promise<unknown> }).staticCall(
    positionId,
    { blockTag }
  );
  if (
    address(tupleField(snapshot, 'recipient', 0, 'DEX V2 hidden snapshot'), 'DEX V2 hidden snapshot recipient') !== owner ||
    tupleField(snapshot, 'initialized', 2, 'DEX V2 hidden snapshot') !== true
  ) {
    throw new Error('DEX V2 hidden owner snapshot is unavailable for this wallet.');
  }
  const aesKey = signer.getUserOnboardInfo()?.aesKey?.trim();
  if (!aesKey) throw new Error('Unlock privacy before revealing the hidden position.');
  const snapshotSequence = uint(tupleField(snapshot, 'sequence', 1, 'DEX V2 hidden snapshot'), 'DEX V2 hidden snapshot sequence');
  const totalInventoryLots = decryptUserUint(tupleField(snapshot, 'primaryLots', 3, 'DEX V2 hidden snapshot'), aesKey, 'DEX V2 total inventory');
  const baseInventoryLots = decryptUserUint(tupleField(snapshot, 'baseClaimOrInventoryLots', 4, 'DEX V2 hidden snapshot'), aesKey, 'DEX V2 base inventory');
  const quoteInventoryLots = decryptUserUint(tupleField(snapshot, 'quoteClaimOrInventoryLots', 5, 'DEX V2 hidden snapshot'), aesKey, 'DEX V2 quote inventory');
  if (snapshotSequence === 0n || totalInventoryLots !== baseInventoryLots + quoteInventoryLots) {
    throw new Error('DEX V2 hidden owner snapshot does not conserve its private inventories.');
  }
  return Object.freeze({
    positionId: positionId.toString(),
    kind,
    lifecycle: lifecycle === 1n ? 'active' : 'paused',
    ownerRevision: expectedOwnerRevision.toString(),
    snapshotSequence: snapshotSequence.toString(),
    totalInventoryLots: totalInventoryLots.toString(),
    baseInventoryLots: baseInventoryLots.toString(),
    quoteInventoryLots: quoteInventoryLots.toString(),
    blockNumber: blockTag.toString(),
    blockHash: verified.attestationBlock.hash
  });
};

export const submitDexV2HiddenAction = async ({
  deployment,
  intent,
  signer
}: {
  deployment: AttestedDexV2Deployment;
  intent: DexV2ActionIntent;
  signer: JsonRpcSigner;
}): Promise<DexV2HiddenSubmission> => {
  const verified = assertAttestedDexV2Deployment(deployment);
  const rawAction = readWalletActionIntent(intent);
  if ([
    'create-pool', 'add-pool', 'withdraw-pool', 'withdraw-all-pool',
    'transfer-position', 'activate-position-privacy', 'swap'
  ].includes(rawAction.kind)) {
    throw new Error('DEX V2 hidden-position execution requires a captured Limit or Recurring intent.');
  }
  const action = rawAction as Extract<DexV2Action, { kind: HiddenActionKind }>;
  const owner = address(await signer.getAddress(), 'DEX V2 hidden-position owner');
  const network = await signer.provider.getNetwork();
  if (network.chainId !== BigInt(verified.manifest.chainId)) {
    throw new Error('The selected wallet is not connected to the activated DEX chain.');
  }
  let positionId: bigint | null = null;
  let expectedOwnerRevision: bigint | null = null;
  let initialLifecycle: bigint | null = null;
  if (action.kind !== 'create-limit' && action.kind !== 'create-recurring') {
    const mutationAction = action as Exclude<typeof action,
      Extract<typeof action, { kind: 'create-limit' | 'create-recurring' }>>;
    positionId = mutationAction.positionId;
    expectedOwnerRevision = mutationAction.expectedOwnerRevision;
    if (mutationAction.positionId <= 0n || mutationAction.expectedOwnerRevision < 0n || mutationAction.expectedOwnerRevision > UINT64_MAX) {
      throw new Error('DEX V2 hidden-position reference is invalid.');
    }
    const core = new Contract(verified.manifest.addresses.core, ABI, signer);
    const blockTag = BigInt(verified.attestationBlock.number);
    const position = await core.getPosition.staticCall(mutationAction.positionId, { blockTag });
    const expectedKind = LIMIT_KINDS.has(action.kind) ? 2n : 3n;
    initialLifecycle = uint(tupleField(position, 'lifecycle', 1, 'DEX V2 hidden position'), 'DEX V2 lifecycle');
    const privacyOwner = address(tupleField(position, 'privacyOwner', 3, 'DEX V2 hidden position'), 'DEX V2 privacy owner');
    if (
      uint(tupleField(position, 'kind', 0, 'DEX V2 hidden position'), 'DEX V2 position kind') !== expectedKind ||
      (initialLifecycle !== 1n && initialLifecycle !== 2n) ||
      bytes32(tupleField(position, 'pairKey', 2, 'DEX V2 hidden position'), 'DEX V2 position pair') !== verified.manifest.pair.pairKey ||
      uint(tupleField(position, 'ownerRevision', 5, 'DEX V2 hidden position'), 'DEX V2 owner revision') !== mutationAction.expectedOwnerRevision
    ) {
      throw new Error('DEX V2 hidden position changed before its owner action was prepared.');
    }
    if ((RESUME_KINDS.has(action.kind) || action.kind === 'update-recurring-ranks' || action.kind === 'add-recurring-liquidity') && privacyOwner !== owner) {
      throw new Error('Activate position privacy before this hidden-position action.');
    }
    const nft = new Contract(verified.manifest.addresses.positionToken, NFT_ABI, signer);
    if (address(await nft.ownerOf.staticCall(mutationAction.positionId, { blockTag }), 'DEX V2 Position NFT owner') !== owner) {
      throw new Error('DEX V2 Position NFT is no longer owned by this wallet.');
    }
  }
  const call = assertPreparedDexV2ActionCall(await prepareDexV2ActionCall({
    deployment: verified,
    intent,
    encryptUint64: (request) => encryptDexV2Uint64Input(signer, request)
  }));
  const transaction = await signer.sendTransaction({
    to: call.to,
    data: call.data,
    value: call.value,
    gasLimit: DEX_V2_POSITION_GAS_LIMIT
  });
  if (
    address(transaction.from, 'DEX V2 hidden-position submitted sender') !== owner ||
    address(transaction.to, 'DEX V2 hidden-position submitted target') !== call.to ||
    String(transaction.data).toLowerCase() !== call.data ||
    uint(transaction.value, 'DEX V2 hidden-position submitted value') !== 0n
  ) {
    throw new Error('The wallet returned a transaction outside the reviewed hidden-position call.');
  }
  const submission = Object.freeze({
    transaction,
    submittedTransactionHash: bytes32(transaction.hash, 'DEX V2 hidden-position submitted hash')
  });
  SUBMISSIONS.set(submission, Object.freeze({
    deployment: verified,
    signer,
    owner,
    kind: action.kind,
    positionId,
    expectedOwnerRevision,
    initialLifecycle
  }));
  return submission;
};

export const confirmDexV2HiddenAction = async ({
  deployment,
  signer,
  submission
}: {
  deployment: AttestedDexV2Deployment;
  signer: JsonRpcSigner;
  submission: DexV2HiddenSubmission;
}): Promise<ConfirmedDexV2HiddenAction> => {
  const verified = assertAttestedDexV2Deployment(deployment);
  const expected = submission && SUBMISSIONS.get(submission);
  if (!expected || expected.deployment !== verified || expected.signer !== signer) {
    throw new Error('DEX V2 hidden-position confirmation requires its exact local submission and wallet lease.');
  }
  const confirmation = await waitForReceipt(submission.transaction);
  const marker = eventFor(expected.kind);
  const parsedEvents = confirmation.receipt.logs.flatMap((log) => {
    if (address(log.address, 'DEX V2 hidden-position log address') !== verified.manifest.addresses.core || log.removed) return [];
    try {
      const parsed = CORE.parseLog({ topics: [...log.topics], data: log.data });
      return parsed?.name === marker.name ? [parsed] : [];
    } catch {
      return [];
    }
  });
  let positionId = expected.positionId;
  const ownerRevision = expected.expectedOwnerRevision === null ? 0n : expected.expectedOwnerRevision + 1n;
  let priorityId: bigint | null = null;
  const matchingEvents = parsedEvents.filter((event) => {
    const eventId = uint(event.args[0], 'DEX V2 hidden-position event ID');
    if (marker.mode === 'created') {
      if (
        bytes32(event.args[1], 'DEX V2 hidden-position event pair') !== verified.manifest.pair.pairKey ||
        address(event.args[2], 'DEX V2 hidden-position event owner') !== expected.owner
      ) return false;
      positionId = eventId;
      priorityId = uint(event.args[3], 'DEX V2 hidden priority ID');
      return eventId > 0n && priorityId >= 5n;
    }
    if (eventId !== positionId) return false;
    if (marker.mode === 'pause') {
      return event.args[1] === PAUSE_KINDS.has(expected.kind) &&
        uint(event.args[2], 'DEX V2 hidden-position event revision') === ownerRevision;
    }
    if (marker.mode === 'closed') {
      return address(event.args[1], 'DEX V2 hidden-position close owner') === expected.owner &&
        uint(event.args[2], 'DEX V2 hidden-position event revision') === ownerRevision;
    }
    return uint(event.args[1], 'DEX V2 hidden-position event revision') === ownerRevision;
  });
  if (matchingEvents.length !== 1 || positionId === null) {
    throw new Error('DEX V2 hidden-position receipt must contain one matching action marker.');
  }
  const core = new Contract(verified.manifest.addresses.core, ABI, signer);
  const position = await core.getPosition.staticCall(positionId, { blockTag: confirmation.receipt.blockNumber });
  const positionKind = LIMIT_KINDS.has(expected.kind) ? 2n : 3n;
  const lifecycle = CLOSED_KINDS.has(expected.kind)
    ? 3n
    : PAUSE_KINDS.has(expected.kind)
      ? 2n
      : RESUME_KINDS.has(expected.kind)
        ? 1n
        : expected.initialLifecycle ?? 1n;
  priorityId ??= uint(tupleField(position, 'priorityId', 6, 'DEX V2 hidden position'), 'DEX V2 hidden priority ID');
  if (
    uint(tupleField(position, 'kind', 0, 'DEX V2 hidden position'), 'DEX V2 position kind') !== positionKind ||
    uint(tupleField(position, 'lifecycle', 1, 'DEX V2 hidden position'), 'DEX V2 lifecycle') !== lifecycle ||
    bytes32(tupleField(position, 'pairKey', 2, 'DEX V2 hidden position'), 'DEX V2 position pair') !== verified.manifest.pair.pairKey ||
    uint(tupleField(position, 'ownerRevision', 5, 'DEX V2 hidden position'), 'DEX V2 owner revision') !== ownerRevision ||
    priorityId < 5n
  ) {
    throw new Error('DEX V2 hidden-position state does not match the confirmed action.');
  }
  const nft = new Contract(verified.manifest.addresses.positionToken, NFT_ABI, signer);
  if (lifecycle === 3n) {
    let ownerStillExists = false;
    try {
      await nft.ownerOf.staticCall(positionId, { blockTag: confirmation.receipt.blockNumber });
      ownerStillExists = true;
    } catch {
      ownerStillExists = false;
    }
    if (ownerStillExists) throw new Error('DEX V2 closed hidden Position NFT was not burned.');
  } else if (address(await nft.ownerOf.staticCall(positionId, {
    blockTag: confirmation.receipt.blockNumber
  }), 'DEX V2 Position NFT owner') !== expected.owner) {
    throw new Error('DEX V2 hidden Position NFT owner changed during the action.');
  }
  const getter = positionKind === 2n ? 'getLimitOwnerSnapshot' : 'getRecurringOwnerSnapshot';
  const snapshot = await (core[getter] as { staticCall: (...args: unknown[]) => Promise<unknown> }).staticCall(
    positionId,
    { blockTag: confirmation.receipt.blockNumber }
  );
  if (
    address(tupleField(snapshot, 'recipient', 0, 'DEX V2 hidden snapshot'), 'DEX V2 hidden snapshot recipient') !== expected.owner ||
    tupleField(snapshot, 'initialized', 2, 'DEX V2 hidden snapshot') !== true
  ) {
    throw new Error('DEX V2 hidden owner snapshot does not match the confirmed action.');
  }
  const aesKey = signer.getUserOnboardInfo()?.aesKey?.trim();
  if (!aesKey) throw new Error('Unlock privacy before confirming the hidden-position action.');
  const snapshotSequence = uint(tupleField(snapshot, 'sequence', 1, 'DEX V2 hidden snapshot'), 'DEX V2 hidden snapshot sequence');
  const totalInventoryLots = decryptUserUint(tupleField(snapshot, 'primaryLots', 3, 'DEX V2 hidden snapshot'), aesKey, 'DEX V2 total inventory');
  const baseInventoryLots = decryptUserUint(tupleField(snapshot, 'baseClaimOrInventoryLots', 4, 'DEX V2 hidden snapshot'), aesKey, 'DEX V2 base inventory');
  const quoteInventoryLots = decryptUserUint(tupleField(snapshot, 'quoteClaimOrInventoryLots', 5, 'DEX V2 hidden snapshot'), aesKey, 'DEX V2 quote inventory');
  if (snapshotSequence === 0n || totalInventoryLots !== baseInventoryLots + quoteInventoryLots) {
    throw new Error('DEX V2 hidden owner snapshot does not conserve its private inventories.');
  }
  return Object.freeze({
    kind: expected.kind,
    positionId: positionId.toString(),
    ownerRevision: ownerRevision.toString(),
    lifecycle: lifecycle === 1n ? 'active' : lifecycle === 2n ? 'paused' : 'closed',
    priorityId: priorityId.toString(),
    snapshotSequence: snapshotSequence.toString(),
    totalInventoryLots: totalInventoryLots.toString(),
    baseInventoryLots: baseInventoryLots.toString(),
    quoteInventoryLots: quoteInventoryLots.toString(),
    transactionHash: confirmation.transactionHash,
    blockNumber: confirmation.receipt.blockNumber.toString(),
    blockHash: bytes32(confirmation.receipt.blockHash, 'DEX V2 hidden-position receipt block hash')
  });
};
