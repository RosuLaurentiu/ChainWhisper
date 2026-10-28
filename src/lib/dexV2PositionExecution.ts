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
  DEX_V2_RECEIPT_TIMEOUT_MS
} from './dexV2SwapExecution';
import { DEX_V2_POSITION_GAS_LIMIT } from './dexV2PoolExecution';
import { readWalletActionIntent } from './walletActionIntent';

const ZERO_ADDRESS = `0x${'00'.repeat(20)}`;
const UINT64_MAX = (1n << 64n) - 1n;
const ABI = Object.freeze([
  ...DEX_V2_ACTION_ABI,
  'event DexPositionTransferActivationRequired(uint256 indexed positionId,address indexed previousOwner,address indexed nextOwner,uint64 ownerRevision)',
  'event DexPositionPrivacyActivated(uint256 indexed positionId,address indexed positionOwner,uint8 kind,uint64 ownerRevision)',
  'function getPosition(uint256 positionId) view returns ((uint8 kind,uint8 lifecycle,bytes32 pairKey,address privacyOwner,uint64 createdAt,uint64 ownerRevision,uint56 priorityId,uint8 hiddenSlot) position)'
] as const);
const CORE = new Interface(ABI);
const NFT_ABI = Object.freeze(['function ownerOf(uint256 tokenId) view returns (address owner)'] as const);

const SUBMISSIONS = new WeakMap<object, Readonly<{
  deployment: AttestedDexV2Deployment;
  signer: JsonRpcSigner;
  owner: string;
  recipient: string | null;
  positionId: bigint;
  expectedOwnerRevision: bigint;
  kind: 'activate-position-privacy' | 'transfer-position';
  positionKind: bigint;
  lifecycle: bigint;
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

const waitForReceipt = async (
  transaction: TransactionResponse
): Promise<Readonly<{ receipt: TransactionReceipt; transactionHash: string }>> => {
  let receipt: TransactionReceipt | null = null;
  let transactionHash = bytes32(transaction.hash, 'DEX V2 position transaction hash');
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
      throw new Error('The Position transaction replacement was cancelled.');
    }
    transactionHash = bytes32(replacement.replacement.hash, 'DEX V2 Position replacement hash');
    receipt = replacement.receipt ?? await replacement.replacement.wait(
      DEX_V2_CONFIRMATIONS,
      DEX_V2_RECEIPT_TIMEOUT_MS
    );
  }
  if (!receipt || receipt.status !== 1) throw new Error('DEX V2 Position transaction did not succeed.');
  if (bytes32(receipt.hash, 'DEX V2 Position receipt hash') !== transactionHash) {
    throw new Error('DEX V2 Position receipt belongs to another transaction.');
  }
  return Object.freeze({ receipt, transactionHash });
};

export type DexV2PositionSubmission = Readonly<{
  transaction: TransactionResponse;
  submittedTransactionHash: string;
}>;

export type ConfirmedDexV2PositionLifecycle = Readonly<{
  kind: 'activate-position-privacy' | 'transfer-position';
  positionId: string;
  ownerRevision: string;
  owner: string;
  recipient: string;
  lifecycle: 'active' | 'paused';
  transactionHash: string;
  blockNumber: string;
  blockHash: string;
}>;

export const submitDexV2PositionLifecycle = async ({
  deployment,
  intent,
  signer
}: {
  deployment: AttestedDexV2Deployment;
  intent: DexV2ActionIntent;
  signer: JsonRpcSigner;
}): Promise<DexV2PositionSubmission> => {
  const verified = assertAttestedDexV2Deployment(deployment);
  const action = readWalletActionIntent(intent);
  if (action.kind !== 'activate-position-privacy' && action.kind !== 'transfer-position') {
    throw new Error('DEX V2 Position execution requires a captured owner-lifecycle intent.');
  }
  if (action.positionId <= 0n || action.expectedOwnerRevision < 0n || action.expectedOwnerRevision > UINT64_MAX) {
    throw new Error('DEX V2 Position reference is invalid.');
  }
  const owner = address(await signer.getAddress(), 'DEX V2 Position owner');
  const network = await signer.provider.getNetwork();
  if (network.chainId !== BigInt(verified.manifest.chainId)) {
    throw new Error('The selected wallet is not connected to the activated DEX chain.');
  }
  const core = new Contract(verified.manifest.addresses.core, ABI, signer);
  const blockTag = BigInt(verified.attestationBlock.number);
  const position = await core.getPosition.staticCall(action.positionId, { blockTag });
  const positionKind = uint(tupleField(position, 'kind', 0, 'DEX V2 position'), 'DEX V2 position kind');
  const lifecycle = uint(tupleField(position, 'lifecycle', 1, 'DEX V2 position'), 'DEX V2 position lifecycle');
  const privacyOwner = address(tupleField(position, 'privacyOwner', 3, 'DEX V2 position'), 'DEX V2 privacy owner');
  if (
    positionKind < 1n || positionKind > 3n ||
    (lifecycle !== 1n && lifecycle !== 2n) ||
    bytes32(tupleField(position, 'pairKey', 2, 'DEX V2 position'), 'DEX V2 position pair') !== verified.manifest.pair.pairKey ||
    uint(tupleField(position, 'ownerRevision', 5, 'DEX V2 position'), 'DEX V2 owner revision') !== action.expectedOwnerRevision
  ) {
    throw new Error('DEX V2 Position changed before its owner action was prepared.');
  }
  if (action.kind === 'activate-position-privacy' && privacyOwner !== ZERO_ADDRESS) {
    throw new Error('DEX V2 Position privacy is already active.');
  }
  const recipient = action.kind === 'transfer-position'
    ? address(action.recipient, 'DEX V2 Position recipient')
    : null;
  if (recipient === owner || recipient === ZERO_ADDRESS) throw new Error('DEX V2 Position recipient is invalid.');
  const nft = new Contract(verified.manifest.addresses.positionToken, NFT_ABI, signer);
  if (address(await nft.ownerOf.staticCall(action.positionId, { blockTag }), 'DEX V2 Position NFT owner') !== owner) {
    throw new Error('DEX V2 Position NFT is no longer owned by this wallet.');
  }
  const call = assertPreparedDexV2ActionCall(await prepareDexV2ActionCall({ deployment: verified, intent }));
  const transaction = await signer.sendTransaction({
    to: call.to,
    data: call.data,
    value: call.value,
    gasLimit: DEX_V2_POSITION_GAS_LIMIT
  });
  if (
    address(transaction.from, 'DEX V2 Position submitted sender') !== owner ||
    address(transaction.to, 'DEX V2 Position submitted target') !== call.to ||
    String(transaction.data).toLowerCase() !== call.data ||
    uint(transaction.value, 'DEX V2 Position submitted value') !== 0n ||
    uint(transaction.chainId, 'DEX V2 Position submitted chain') !== BigInt(verified.manifest.chainId)
  ) {
    throw new Error('The wallet returned a transaction outside the reviewed Position owner call.');
  }
  const submission = Object.freeze({
    transaction,
    submittedTransactionHash: bytes32(transaction.hash, 'DEX V2 Position submitted transaction hash')
  });
  SUBMISSIONS.set(submission, Object.freeze({
    deployment: verified,
    signer,
    owner,
    recipient,
    positionId: action.positionId,
    expectedOwnerRevision: action.expectedOwnerRevision,
    kind: action.kind,
    positionKind,
    lifecycle
  }));
  return submission;
};

export const confirmDexV2PositionLifecycle = async ({
  deployment,
  signer,
  submission
}: {
  deployment: AttestedDexV2Deployment;
  signer: JsonRpcSigner;
  submission: DexV2PositionSubmission;
}): Promise<ConfirmedDexV2PositionLifecycle> => {
  const verified = assertAttestedDexV2Deployment(deployment);
  const expected = submission && SUBMISSIONS.get(submission);
  if (!expected || expected.deployment !== verified || expected.signer !== signer) {
    throw new Error('DEX V2 Position confirmation requires its exact local submission and wallet lease.');
  }
  const confirmation = await waitForReceipt(submission.transaction);
  const nextRevision = expected.expectedOwnerRevision + 1n;
  const eventName = expected.kind === 'activate-position-privacy'
    ? 'DexPositionPrivacyActivated'
    : 'DexPositionTransferActivationRequired';
  const events = confirmation.receipt.logs.flatMap((log) => {
    if (address(log.address, 'DEX V2 Position log address') !== verified.manifest.addresses.core || log.removed) return [];
    try {
      const parsed = CORE.parseLog({ topics: [...log.topics], data: log.data });
      return parsed?.name === eventName ? [parsed] : [];
    } catch {
      return [];
    }
  }).filter((event) => {
    if (uint(event.args[0], 'DEX V2 Position event ID') !== expected.positionId) return false;
    if (expected.kind === 'activate-position-privacy') {
      return address(event.args[1], 'DEX V2 Position event owner') === expected.owner &&
        uint(event.args[2], 'DEX V2 Position event kind') === expected.positionKind &&
        uint(event.args[3], 'DEX V2 Position event revision') === nextRevision;
    }
    return address(event.args[1], 'DEX V2 Position previous owner') === expected.owner &&
      address(event.args[2], 'DEX V2 Position next owner') === expected.recipient &&
      uint(event.args[3], 'DEX V2 Position event revision') === nextRevision;
  });
  if (events.length !== 1) throw new Error('DEX V2 Position receipt must contain one matching lifecycle marker.');
  const core = new Contract(verified.manifest.addresses.core, ABI, signer);
  const position = await core.getPosition.staticCall(expected.positionId, { blockTag: confirmation.receipt.blockNumber });
  const finalOwner = expected.recipient ?? expected.owner;
  const expectedLifecycle = expected.kind === 'transfer-position' && expected.positionKind !== 1n
    ? 2n
    : expected.lifecycle;
  if (
    uint(tupleField(position, 'kind', 0, 'DEX V2 position'), 'DEX V2 position kind') !== expected.positionKind ||
    uint(tupleField(position, 'lifecycle', 1, 'DEX V2 position'), 'DEX V2 position lifecycle') !== expectedLifecycle ||
    address(tupleField(position, 'privacyOwner', 3, 'DEX V2 position'), 'DEX V2 privacy owner') !==
      (expected.kind === 'activate-position-privacy' ? expected.owner : ZERO_ADDRESS) ||
    uint(tupleField(position, 'ownerRevision', 5, 'DEX V2 position'), 'DEX V2 owner revision') !== nextRevision
  ) {
    throw new Error('DEX V2 Position state does not match the confirmed lifecycle action.');
  }
  const nft = new Contract(verified.manifest.addresses.positionToken, NFT_ABI, signer);
  if (address(await nft.ownerOf.staticCall(expected.positionId, {
    blockTag: confirmation.receipt.blockNumber
  }), 'DEX V2 Position NFT owner') !== finalOwner) {
    throw new Error('DEX V2 Position NFT owner does not match the confirmed lifecycle action.');
  }
  return Object.freeze({
    kind: expected.kind,
    positionId: expected.positionId.toString(),
    ownerRevision: nextRevision.toString(),
    owner: expected.owner,
    recipient: finalOwner,
    lifecycle: expectedLifecycle === 1n ? 'active' : 'paused',
    transactionHash: confirmation.transactionHash,
    blockNumber: confirmation.receipt.blockNumber.toString(),
    blockHash: bytes32(confirmation.receipt.blockHash, 'DEX V2 Position receipt block hash')
  });
};
