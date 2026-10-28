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
  type DexV2ActionIntent
} from './dexV2Actions';
import {
  DEX_V2_CONFIRMATIONS,
  DEX_V2_RECEIPT_TIMEOUT_MS,
  encryptDexV2Uint64Input
} from './dexV2SwapExecution';
import { readWalletActionIntent } from './walletActionIntent';

export const DEX_V2_POSITION_GAS_LIMIT = 90_000_000n;

export const DEX_V2_POOL_RECEIPT_ABI = Object.freeze([
  ...DEX_V2_ACTION_ABI,
  'event DexPoolPositionCreated(uint256 indexed positionId,bytes32 indexed pairKey,address indexed owner,uint64 ownerRevision)',
  'event DexPoolLiquidityAdded(uint256 indexed positionId,uint64 ownerRevision)',
  'event DexPoolLiquidityWithdrawn(uint256 indexed positionId,uint64 ownerRevision)',
  'event DexPoolPositionClosed(uint256 indexed positionId,address indexed owner,uint64 ownerRevision)',
  'function getPosition(uint256 positionId) view returns ((uint8 kind,uint8 lifecycle,bytes32 pairKey,address privacyOwner,uint64 createdAt,uint64 ownerRevision,uint56 priorityId,uint8 hiddenSlot) position)',
  'function getPoolOwnerSnapshot(uint256 positionId) returns ((address recipient,uint64 sequence,bool initialized,(uint256 ciphertext,uint256 userCiphertext) primaryLots,(uint256 ciphertext,uint256 userCiphertext) baseClaimOrInventoryLots,(uint256 ciphertext,uint256 userCiphertext) quoteClaimOrInventoryLots) snapshot)'
] as const);

const POSITION_NFT_ABI = Object.freeze([
  'function ownerOf(uint256 tokenId) view returns (address owner)'
] as const);

const POOL = new Interface(DEX_V2_POOL_RECEIPT_ABI);
const BYTES32 = /^0x[0-9a-f]{64}$/;
const SUBMISSIONS = new WeakMap<object, Readonly<{
  deployment: AttestedDexV2Deployment;
  owner: string;
  baseMaximumLots: bigint;
  quoteMaximumLots: bigint;
  signer: JsonRpcSigner;
}>>();
const MUTATION_SUBMISSIONS = new WeakMap<object, Readonly<{
  deployment: AttestedDexV2Deployment;
  owner: string;
  positionId: bigint;
  expectedOwnerRevision: bigint;
  kind: 'add-pool' | 'withdraw-pool' | 'withdraw-all-pool';
  signer: JsonRpcSigner;
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
  if (typeof value !== 'string' || !BYTES32.test(value.toLowerCase())) {
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

const waitForPositionReceipt = async (
  transaction: TransactionResponse
): Promise<Readonly<{ receipt: TransactionReceipt; transactionHash: string }>> => {
  let receipt: TransactionReceipt | null = null;
  let transactionHash = bytes32(transaction.hash, 'DEX V2 Pool transaction hash');
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
      throw new Error('The Pool transaction replacement was cancelled.');
    }
    transactionHash = bytes32(replacement.replacement.hash, 'DEX V2 Pool replacement hash');
    receipt = replacement.receipt ?? await replacement.replacement.wait(
      DEX_V2_CONFIRMATIONS,
      DEX_V2_RECEIPT_TIMEOUT_MS
    );
  }
  if (!receipt || receipt.status !== 1) throw new Error('DEX V2 Pool transaction did not succeed.');
  if (bytes32(receipt.hash, 'DEX V2 Pool receipt hash') !== transactionHash) {
    throw new Error('DEX V2 Pool receipt belongs to another transaction.');
  }
  return Object.freeze({ receipt, transactionHash });
};

export type DexV2PoolSubmission = Readonly<{
  transaction: TransactionResponse;
  submittedTransactionHash: string;
}>;

export type ConfirmedDexV2PoolPosition = Readonly<{
  positionId: string;
  ownerRevision: string;
  snapshotSequence: string;
  shares: string;
  baseClaimLots: string;
  quoteClaimLots: string;
  transactionHash: string;
  blockNumber: string;
  blockHash: string;
}>;

export type RevealedDexV2PoolPosition = Readonly<{
  positionId: string;
  ownerRevision: string;
  snapshotSequence: string;
  shares: string;
  baseClaimLots: string;
  quoteClaimLots: string;
  blockNumber: string;
  blockHash: string;
}>;

export const revealDexV2PoolPosition = async ({
  deployment,
  positionId,
  expectedOwnerRevision,
  signer
}: {
  deployment: AttestedDexV2Deployment;
  positionId: bigint;
  expectedOwnerRevision: bigint;
  signer: JsonRpcSigner;
}): Promise<RevealedDexV2PoolPosition> => {
  const verified = assertAttestedDexV2Deployment(deployment);
  const id = uint(positionId, 'DEX V2 Pool position ID');
  const revision = uint(expectedOwnerRevision, 'DEX V2 Pool owner revision');
  if (id === 0n || revision > (1n << 64n) - 1n) {
    throw new Error('DEX V2 Pool position reference is invalid.');
  }
  const owner = address(await signer.getAddress(), 'DEX V2 Pool owner');
  const network = await signer.provider.getNetwork();
  if (network.chainId !== BigInt(verified.manifest.chainId)) {
    throw new Error('The selected wallet is not connected to the activated DEX chain.');
  }
  const blockNumber = BigInt(verified.attestationBlock.number);
  const core = new Contract(verified.manifest.addresses.core, DEX_V2_POOL_RECEIPT_ABI, signer);
  const position = await core.getPosition.staticCall(id, { blockTag: blockNumber });
  if (
    uint(tupleField(position, 'kind', 0, 'DEX V2 Pool position'), 'DEX V2 Pool position kind') !== 1n ||
    uint(tupleField(position, 'lifecycle', 1, 'DEX V2 Pool position'), 'DEX V2 Pool lifecycle') !== 1n ||
    bytes32(tupleField(position, 'pairKey', 2, 'DEX V2 Pool position'), 'DEX V2 Pool position pair') !== verified.manifest.pair.pairKey ||
    address(tupleField(position, 'privacyOwner', 3, 'DEX V2 Pool position'), 'DEX V2 Pool privacy owner') !== owner ||
    uint(tupleField(position, 'ownerRevision', 5, 'DEX V2 Pool position'), 'DEX V2 Pool owner revision') !== revision
  ) {
    throw new Error('DEX V2 Pool position changed before its private claim was revealed.');
  }
  const positionToken = new Contract(verified.manifest.addresses.positionToken, POSITION_NFT_ABI, signer);
  if (address(await positionToken.ownerOf.staticCall(id, { blockTag: blockNumber }), 'DEX V2 Pool NFT owner') !== owner) {
    throw new Error('DEX V2 Pool Position NFT is no longer owned by this wallet.');
  }
  const snapshot = await core.getPoolOwnerSnapshot.staticCall(id, { blockTag: blockNumber });
  if (
    address(tupleField(snapshot, 'recipient', 0, 'DEX V2 Pool snapshot'), 'DEX V2 Pool snapshot recipient') !== owner ||
    tupleField(snapshot, 'initialized', 2, 'DEX V2 Pool snapshot') !== true
  ) {
    throw new Error('DEX V2 Pool owner snapshot is unavailable for this wallet.');
  }
  const aesKey = signer.getUserOnboardInfo()?.aesKey?.trim();
  if (!aesKey) throw new Error('Unlock privacy before revealing the Pool position.');
  const snapshotSequence = uint(tupleField(snapshot, 'sequence', 1, 'DEX V2 Pool snapshot'), 'DEX V2 Pool snapshot sequence');
  const shares = decryptUserUint(tupleField(snapshot, 'primaryLots', 3, 'DEX V2 Pool snapshot'), aesKey, 'DEX V2 Pool shares');
  const baseClaimLots = decryptUserUint(
    tupleField(snapshot, 'baseClaimOrInventoryLots', 4, 'DEX V2 Pool snapshot'),
    aesKey,
    'DEX V2 Pool base claim'
  );
  const quoteClaimLots = decryptUserUint(
    tupleField(snapshot, 'quoteClaimOrInventoryLots', 5, 'DEX V2 Pool snapshot'),
    aesKey,
    'DEX V2 Pool quote claim'
  );
  if (snapshotSequence === 0n || shares === 0n || (baseClaimLots === 0n && quoteClaimLots === 0n)) {
    throw new Error('DEX V2 Pool owner snapshot contains an empty position.');
  }
  return Object.freeze({
    positionId: id.toString(),
    ownerRevision: revision.toString(),
    snapshotSequence: snapshotSequence.toString(),
    shares: shares.toString(),
    baseClaimLots: baseClaimLots.toString(),
    quoteClaimLots: quoteClaimLots.toString(),
    blockNumber: blockNumber.toString(),
    blockHash: verified.attestationBlock.hash
  });
};

export type DexV2PoolMutationSubmission = Readonly<{
  transaction: TransactionResponse;
  submittedTransactionHash: string;
}>;

export type ConfirmedDexV2PoolMutation = Readonly<{
  kind: 'add-pool' | 'withdraw-pool' | 'withdraw-all-pool';
  positionId: string;
  ownerRevision: string;
  closed: boolean;
  snapshotSequence: string;
  shares: string;
  baseClaimOrWithdrawalLots: string;
  quoteClaimOrWithdrawalLots: string;
  transactionHash: string;
  blockNumber: string;
  blockHash: string;
}>;

export const submitDexV2PoolMutation = async ({
  deployment,
  intent,
  signer
}: {
  deployment: AttestedDexV2Deployment;
  intent: DexV2ActionIntent;
  signer: JsonRpcSigner;
}): Promise<DexV2PoolMutationSubmission> => {
  const verified = assertAttestedDexV2Deployment(deployment);
  const action = readWalletActionIntent(intent);
  if (!['add-pool', 'withdraw-pool', 'withdraw-all-pool'].includes(action.kind)) {
    throw new Error('DEX V2 Pool mutation requires a captured Pool owner intent.');
  }
  const poolAction = action as Extract<typeof action, {
    kind: 'add-pool' | 'withdraw-pool' | 'withdraw-all-pool';
  }>;
  const owner = address(await signer.getAddress(), 'DEX V2 Pool owner');
  const network = await signer.provider.getNetwork();
  if (network.chainId !== BigInt(verified.manifest.chainId)) {
    throw new Error('The selected wallet is not connected to the activated DEX chain.');
  }
  const core = new Contract(verified.manifest.addresses.core, DEX_V2_POOL_RECEIPT_ABI, signer);
  const position = await core.getPosition.staticCall(poolAction.positionId, {
    blockTag: BigInt(verified.attestationBlock.number)
  });
  const privacyOwner = address(tupleField(position, 'privacyOwner', 3, 'DEX V2 Pool position'), 'DEX V2 Pool privacy owner');
  if (
    uint(tupleField(position, 'kind', 0, 'DEX V2 Pool position'), 'DEX V2 Pool position kind') !== 1n ||
    uint(tupleField(position, 'lifecycle', 1, 'DEX V2 Pool position'), 'DEX V2 Pool lifecycle') !== 1n ||
    bytes32(tupleField(position, 'pairKey', 2, 'DEX V2 Pool position'), 'DEX V2 Pool position pair') !== verified.manifest.pair.pairKey ||
    (privacyOwner !== owner && privacyOwner !== `0x${'00'.repeat(20)}`) ||
    uint(tupleField(position, 'ownerRevision', 5, 'DEX V2 Pool position'), 'DEX V2 Pool owner revision') !== poolAction.expectedOwnerRevision
  ) {
    throw new Error('DEX V2 Pool position changed before its owner action was prepared.');
  }
  if (poolAction.kind === 'add-pool' && privacyOwner !== owner) {
    throw new Error('Activate Pool position privacy before adding liquidity.');
  }
  const positionToken = new Contract(verified.manifest.addresses.positionToken, POSITION_NFT_ABI, signer);
  if (address(await positionToken.ownerOf.staticCall(poolAction.positionId, {
    blockTag: BigInt(verified.attestationBlock.number)
  }), 'DEX V2 Pool NFT owner') !== owner) {
    throw new Error('DEX V2 Pool Position NFT is no longer owned by this wallet.');
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
    address(transaction.from, 'DEX V2 Pool submitted sender') !== owner ||
    address(transaction.to, 'DEX V2 Pool submitted target') !== call.to ||
    String(transaction.data).toLowerCase() !== call.data ||
    uint(transaction.value, 'DEX V2 Pool submitted value') !== 0n
  ) {
    throw new Error('The wallet returned a transaction outside the reviewed Pool owner call.');
  }
  const submission = Object.freeze({
    transaction,
    submittedTransactionHash: bytes32(transaction.hash, 'DEX V2 Pool submitted transaction hash')
  });
  MUTATION_SUBMISSIONS.set(submission, Object.freeze({
    deployment: verified,
    owner,
    positionId: poolAction.positionId,
    expectedOwnerRevision: poolAction.expectedOwnerRevision,
    kind: poolAction.kind,
    signer
  }));
  return submission;
};

export const confirmDexV2PoolMutation = async ({
  deployment,
  signer,
  submission
}: {
  deployment: AttestedDexV2Deployment;
  signer: JsonRpcSigner;
  submission: DexV2PoolMutationSubmission;
}): Promise<ConfirmedDexV2PoolMutation> => {
  const verified = assertAttestedDexV2Deployment(deployment);
  const expected = submission && MUTATION_SUBMISSIONS.get(submission);
  if (!expected || expected.deployment !== verified || expected.signer !== signer) {
    throw new Error('DEX V2 Pool mutation confirmation requires its exact local submission and wallet lease.');
  }
  const confirmation = await waitForPositionReceipt(submission.transaction);
  const eventName = expected.kind === 'add-pool'
    ? 'DexPoolLiquidityAdded'
    : expected.kind === 'withdraw-pool'
      ? 'DexPoolLiquidityWithdrawn'
      : 'DexPoolPositionClosed';
  const nextRevision = expected.expectedOwnerRevision + 1n;
  if (nextRevision > (1n << 64n) - 1n) throw new Error('DEX V2 Pool owner revision overflowed.');
  const matchingEvents = confirmation.receipt.logs.flatMap((log) => {
    if (address(log.address, 'DEX V2 Pool log address') !== verified.manifest.addresses.core || log.removed) return [];
    try {
      const parsed = POOL.parseLog({ topics: [...log.topics], data: log.data });
      return parsed?.name === eventName ? [parsed] : [];
    } catch {
      return [];
    }
  }).filter((event) =>
    uint(event.args[0], 'DEX V2 Pool event position ID') === expected.positionId &&
    (expected.kind !== 'withdraw-all-pool' || address(event.args[1], 'DEX V2 Pool close owner') === expected.owner) &&
    uint(
      event.args[expected.kind === 'withdraw-all-pool' ? 2 : 1],
      'DEX V2 Pool event owner revision'
    ) === nextRevision
  );
  if (matchingEvents.length !== 1) {
    throw new Error('DEX V2 Pool receipt must contain exactly one matching owner-action marker.');
  }
  const core = new Contract(verified.manifest.addresses.core, DEX_V2_POOL_RECEIPT_ABI, signer);
  const position = await core.getPosition.staticCall(expected.positionId, {
    blockTag: confirmation.receipt.blockNumber
  });
  const closed = expected.kind === 'withdraw-all-pool';
  if (
    uint(tupleField(position, 'kind', 0, 'DEX V2 Pool position'), 'DEX V2 Pool position kind') !== 1n ||
    uint(tupleField(position, 'lifecycle', 1, 'DEX V2 Pool position'), 'DEX V2 Pool lifecycle') !== (closed ? 3n : 1n) ||
    bytes32(tupleField(position, 'pairKey', 2, 'DEX V2 Pool position'), 'DEX V2 Pool position pair') !== verified.manifest.pair.pairKey ||
    uint(tupleField(position, 'ownerRevision', 5, 'DEX V2 Pool position'), 'DEX V2 Pool owner revision') !== nextRevision
  ) {
    throw new Error('DEX V2 Pool position state does not match the confirmed owner action.');
  }
  const positionToken = new Contract(verified.manifest.addresses.positionToken, POSITION_NFT_ABI, signer);
  if (closed) {
    let ownerStillExists = false;
    try {
      await positionToken.ownerOf.staticCall(expected.positionId, { blockTag: confirmation.receipt.blockNumber });
      ownerStillExists = true;
    } catch {
      ownerStillExists = false;
    }
    if (ownerStillExists) throw new Error('DEX V2 closed Pool Position NFT was not burned.');
  } else if (address(await positionToken.ownerOf.staticCall(expected.positionId, {
    blockTag: confirmation.receipt.blockNumber
  }), 'DEX V2 Pool NFT owner') !== expected.owner) {
    throw new Error('DEX V2 Pool Position NFT owner changed during the owner action.');
  }
  const snapshot = await core.getPoolOwnerSnapshot.staticCall(expected.positionId, {
    blockTag: confirmation.receipt.blockNumber
  });
  if (
    address(tupleField(snapshot, 'recipient', 0, 'DEX V2 Pool snapshot'), 'DEX V2 Pool snapshot recipient') !== expected.owner ||
    tupleField(snapshot, 'initialized', 2, 'DEX V2 Pool snapshot') !== true
  ) {
    throw new Error('DEX V2 Pool snapshot does not match the confirmed owner action.');
  }
  const aesKey = signer.getUserOnboardInfo()?.aesKey?.trim();
  if (!aesKey) throw new Error('Unlock privacy before confirming the Pool owner action.');
  const snapshotSequence = uint(tupleField(snapshot, 'sequence', 1, 'DEX V2 Pool snapshot'), 'DEX V2 Pool snapshot sequence');
  const shares = decryptUserUint(tupleField(snapshot, 'primaryLots', 3, 'DEX V2 Pool snapshot'), aesKey, 'DEX V2 Pool shares');
  const baseLots = decryptUserUint(
    tupleField(snapshot, 'baseClaimOrInventoryLots', 4, 'DEX V2 Pool snapshot'),
    aesKey,
    'DEX V2 Pool base amount'
  );
  const quoteLots = decryptUserUint(
    tupleField(snapshot, 'quoteClaimOrInventoryLots', 5, 'DEX V2 Pool snapshot'),
    aesKey,
    'DEX V2 Pool quote amount'
  );
  if (snapshotSequence === 0n || (closed ? shares !== 0n : shares === 0n)) {
    throw new Error('DEX V2 Pool snapshot shares do not match the owner action.');
  }
  return Object.freeze({
    kind: expected.kind,
    positionId: expected.positionId.toString(),
    ownerRevision: nextRevision.toString(),
    closed,
    snapshotSequence: snapshotSequence.toString(),
    shares: shares.toString(),
    baseClaimOrWithdrawalLots: baseLots.toString(),
    quoteClaimOrWithdrawalLots: quoteLots.toString(),
    transactionHash: confirmation.transactionHash,
    blockNumber: confirmation.receipt.blockNumber.toString(),
    blockHash: bytes32(confirmation.receipt.blockHash, 'DEX V2 Pool receipt block hash')
  });
};

export const submitDexV2PoolPosition = async ({
  deployment,
  intent,
  signer
}: {
  deployment: AttestedDexV2Deployment;
  intent: DexV2ActionIntent;
  signer: JsonRpcSigner;
}): Promise<DexV2PoolSubmission> => {
  const verified = assertAttestedDexV2Deployment(deployment);
  const action = readWalletActionIntent(intent);
  if (action.kind !== 'create-pool') {
    throw new Error('DEX V2 Pool execution requires a captured create-Pool intent.');
  }
  const owner = address(await signer.getAddress(), 'DEX V2 Pool owner');
  const network = await signer.provider.getNetwork();
  if (network.chainId !== BigInt(verified.manifest.chainId)) {
    throw new Error('The selected wallet is not connected to the activated DEX chain.');
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
    address(transaction.from, 'DEX V2 Pool submitted sender') !== owner ||
    address(transaction.to, 'DEX V2 Pool submitted target') !== call.to ||
    String(transaction.data).toLowerCase() !== call.data ||
    uint(transaction.value, 'DEX V2 Pool submitted value') !== 0n
  ) {
    throw new Error('The wallet returned a transaction outside the reviewed Pool call.');
  }
  const submission = Object.freeze({
    transaction,
    submittedTransactionHash: bytes32(transaction.hash, 'DEX V2 Pool submitted transaction hash')
  });
  SUBMISSIONS.set(submission, Object.freeze({
    deployment: verified,
    owner,
    baseMaximumLots: action.baseMaximumLots,
    quoteMaximumLots: action.quoteMaximumLots,
    signer
  }));
  return submission;
};

export const confirmDexV2PoolPosition = async ({
  deployment,
  signer,
  submission
}: {
  deployment: AttestedDexV2Deployment;
  signer: JsonRpcSigner;
  submission: DexV2PoolSubmission;
}): Promise<ConfirmedDexV2PoolPosition> => {
  const verified = assertAttestedDexV2Deployment(deployment);
  const expected = submission && SUBMISSIONS.get(submission);
  if (!expected || expected.deployment !== verified || expected.signer !== signer) {
    throw new Error('DEX V2 Pool confirmation requires its exact local submission and wallet lease.');
  }
  const confirmation = await waitForPositionReceipt(submission.transaction);
  const matchingEvents = confirmation.receipt.logs.flatMap((log) => {
    if (address(log.address, 'DEX V2 Pool log address') !== verified.manifest.addresses.core || log.removed) return [];
    try {
      const parsed = POOL.parseLog({ topics: [...log.topics], data: log.data });
      return parsed?.name === 'DexPoolPositionCreated' ? [parsed] : [];
    } catch {
      return [];
    }
  }).filter((event) =>
    bytes32(event.args[1], 'DEX V2 Pool event pair') === verified.manifest.pair.pairKey &&
    address(event.args[2], 'DEX V2 Pool event owner') === expected.owner &&
    uint(event.args[3], 'DEX V2 Pool event revision') === 0n
  );
  if (matchingEvents.length !== 1) {
    throw new Error('DEX V2 Pool receipt must contain exactly one matching position marker.');
  }
  const positionId = uint(matchingEvents[0].args[0], 'DEX V2 Pool position ID');
  if (positionId === 0n) throw new Error('DEX V2 Pool position ID cannot be zero.');

  const core = new Contract(verified.manifest.addresses.core, DEX_V2_POOL_RECEIPT_ABI, signer);
  const position = await core.getPosition.staticCall(positionId, {
    blockTag: confirmation.receipt.blockNumber
  });
  if (
    uint(tupleField(position, 'kind', 0, 'DEX V2 Pool position'), 'DEX V2 Pool position kind') !== 1n ||
    uint(tupleField(position, 'lifecycle', 1, 'DEX V2 Pool position'), 'DEX V2 Pool lifecycle') !== 1n ||
    bytes32(tupleField(position, 'pairKey', 2, 'DEX V2 Pool position'), 'DEX V2 Pool position pair') !== verified.manifest.pair.pairKey ||
    address(tupleField(position, 'privacyOwner', 3, 'DEX V2 Pool position'), 'DEX V2 Pool privacy owner') !== expected.owner ||
    uint(tupleField(position, 'ownerRevision', 5, 'DEX V2 Pool position'), 'DEX V2 Pool owner revision') !== 0n ||
    uint(tupleField(position, 'priorityId', 6, 'DEX V2 Pool position'), 'DEX V2 Pool priority') !== 0n ||
    uint(tupleField(position, 'hiddenSlot', 7, 'DEX V2 Pool position'), 'DEX V2 Pool hidden slot') !== 0n
  ) {
    throw new Error('DEX V2 Pool position state does not match the confirmed creation.');
  }
  const positionToken = new Contract(verified.manifest.addresses.positionToken, POSITION_NFT_ABI, signer);
  if (address(await positionToken.ownerOf.staticCall(positionId, {
    blockTag: confirmation.receipt.blockNumber
  }), 'DEX V2 Pool NFT owner') !== expected.owner) {
    throw new Error('DEX V2 Pool Position NFT owner does not match the submitting wallet.');
  }

  const snapshot = await core.getPoolOwnerSnapshot.staticCall(positionId, {
    blockTag: confirmation.receipt.blockNumber
  });
  if (
    address(tupleField(snapshot, 'recipient', 0, 'DEX V2 Pool snapshot'), 'DEX V2 Pool snapshot recipient') !== expected.owner ||
    tupleField(snapshot, 'initialized', 2, 'DEX V2 Pool snapshot') !== true
  ) {
    throw new Error('DEX V2 Pool owner snapshot does not match the confirmed position.');
  }
  const snapshotSequence = uint(
    tupleField(snapshot, 'sequence', 1, 'DEX V2 Pool snapshot'),
    'DEX V2 Pool snapshot sequence'
  );
  if (snapshotSequence === 0n) throw new Error('DEX V2 Pool snapshot sequence cannot be zero.');
  const aesKey = signer.getUserOnboardInfo()?.aesKey?.trim();
  if (!aesKey) throw new Error('Unlock privacy before revealing the Pool position receipt.');
  const shares = decryptUserUint(
    tupleField(snapshot, 'primaryLots', 3, 'DEX V2 Pool snapshot'),
    aesKey,
    'DEX V2 Pool shares'
  );
  const baseClaimLots = decryptUserUint(
    tupleField(snapshot, 'baseClaimOrInventoryLots', 4, 'DEX V2 Pool snapshot'),
    aesKey,
    'DEX V2 Pool base claim'
  );
  const quoteClaimLots = decryptUserUint(
    tupleField(snapshot, 'quoteClaimOrInventoryLots', 5, 'DEX V2 Pool snapshot'),
    aesKey,
    'DEX V2 Pool quote claim'
  );
  if (shares === 0n || baseClaimLots === 0n || quoteClaimLots === 0n) {
    throw new Error('DEX V2 Pool owner snapshot contains an empty position.');
  }
  if (baseClaimLots > expected.baseMaximumLots || quoteClaimLots > expected.quoteMaximumLots) {
    throw new Error('DEX V2 Pool owner claim exceeds the reviewed deposit maxima.');
  }
  return Object.freeze({
    positionId: positionId.toString(),
    ownerRevision: '0',
    snapshotSequence: snapshotSequence.toString(),
    shares: shares.toString(),
    baseClaimLots: baseClaimLots.toString(),
    quoteClaimLots: quoteClaimLots.toString(),
    transactionHash: confirmation.transactionHash,
    blockNumber: confirmation.receipt.blockNumber.toString(),
    blockHash: bytes32(confirmation.receipt.blockHash, 'DEX V2 Pool receipt block hash')
  });
};
