import {
  Contract,
  Interface,
  getAddress,
  type JsonRpcSigner,
  type TransactionReceipt,
  type TransactionResponse
} from '@coti-io/coti-ethers';
import { decryptUint } from '@coti-io/coti-sdk-typescript';
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
import { dexV2DirectionCode, type DexV2SwapDirection } from './dexV2Terms';
import { readWalletActionIntent } from './walletActionIntent';
import { encryptAuthenticatedUint64Input } from './authenticatedUint64';

export const DEX_V2_ROUTE_GAS_LIMIT = 90_000_000n;
export const DEX_V2_CONFIRMATIONS = 5;
export const DEX_V2_RECEIPT_TIMEOUT_MS = 60_000;

export const DEX_V2_SWAP_RECEIPT_ABI = Object.freeze([
  ...DEX_V2_ACTION_ABI,
  'event DexSwapProcessed(uint256 indexed swapId,bytes32 indexed pairKey,address indexed trader,uint8 direction,uint64 publicPoolMarginalTick)',
  'function getMySwapReceipt(uint256 swapId) view returns ((address recipient,bytes32 pairKey,uint8 direction,bool initialized,(uint256 ciphertext,uint256 userCiphertext) inputUsedLots,(uint256 ciphertext,uint256 userCiphertext) outputAmountLots,(uint256 ciphertext,uint256 userCiphertext) unusedInputLots,(uint256 ciphertext,uint256 userCiphertext) invalid) receipt)'
] as const);

const SWAP = new Interface(DEX_V2_SWAP_RECEIPT_ABI);
const BYTES32 = /^0x[0-9a-f]{64}$/;
const SUBMISSIONS = new WeakMap<object, Readonly<{
  deployment: AttestedDexV2Deployment;
  direction: DexV2SwapDirection;
  maximumInputLots: bigint;
  signer: JsonRpcSigner;
}>>();

const bytes32 = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || !BYTES32.test(value.toLowerCase())) {
    throw new Error(`${label} is invalid.`);
  }
  return value.toLowerCase();
};

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

export const encryptDexV2Uint64Input = encryptAuthenticatedUint64Input;

export type DexV2SwapSubmission = Readonly<{
  transaction: TransactionResponse;
  submittedTransactionHash: string;
}>;

export type ConfirmedDexV2Swap = Readonly<{
  swapId: string;
  transactionHash: string;
  blockNumber: string;
  blockHash: string;
  direction: DexV2SwapDirection;
  publicPoolMarginalTick: string;
  inputUsedLots: string;
  outputAmountLots: string;
  unusedInputLots: string;
  invalid: boolean;
}>;

export const submitDexV2Swap = async ({
  deployment,
  intent,
  signer
}: {
  deployment: AttestedDexV2Deployment;
  intent: DexV2ActionIntent;
  signer: JsonRpcSigner;
}): Promise<DexV2SwapSubmission> => {
  const verified = assertAttestedDexV2Deployment(deployment);
  const action = readWalletActionIntent(intent);
  if (action.kind !== 'swap') throw new Error('DEX V2 swap execution requires a captured swap intent.');
  const owner = address(await signer.getAddress(), 'DEX V2 wallet address');
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
    gasLimit: DEX_V2_ROUTE_GAS_LIMIT
  });
  if (
    address(transaction.from, 'DEX V2 submitted sender') !== owner ||
    address(transaction.to, 'DEX V2 submitted target') !== call.to ||
    String(transaction.data).toLowerCase() !== call.data ||
    uint(transaction.value, 'DEX V2 submitted value') !== 0n
  ) {
    throw new Error('The wallet returned a transaction outside the reviewed DEX call.');
  }
  const submission = Object.freeze({
    transaction,
    submittedTransactionHash: bytes32(transaction.hash, 'DEX V2 submitted transaction hash')
  });
  SUBMISSIONS.set(submission, Object.freeze({
    deployment: verified,
    direction: action.direction,
    maximumInputLots: action.maximumInputLots,
    signer
  }));
  return submission;
};

const confirmedReceipt = async (
  transaction: TransactionResponse
): Promise<Readonly<{ receipt: TransactionReceipt; transactionHash: string }>> => {
  let receipt: TransactionReceipt | null = null;
  let transactionHash = bytes32(transaction.hash, 'DEX V2 transaction hash');
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
      throw new Error('The DEX swap replacement was cancelled.');
    }
    transactionHash = bytes32(replacement.replacement.hash, 'DEX V2 replacement hash');
    receipt = replacement.receipt ?? await replacement.replacement.wait(
      DEX_V2_CONFIRMATIONS,
      DEX_V2_RECEIPT_TIMEOUT_MS
    );
  }
  if (!receipt || receipt.status !== 1) throw new Error('DEX V2 swap transaction did not succeed.');
  if (bytes32(receipt.hash, 'DEX V2 receipt transaction hash') !== transactionHash) {
    throw new Error('DEX V2 receipt belongs to another transaction.');
  }
  return Object.freeze({ receipt, transactionHash });
};

const tupleField = (value: unknown, name: string, index: number, label: string): unknown => {
  if (!value || typeof value !== 'object') throw new Error(`${label} is malformed.`);
  const tuple = value as Record<string | number, unknown>;
  return tuple[name] ?? tuple[index];
};

const decryptUserUint = (
  value: unknown,
  aesKey: string,
  label: string
): bigint => {
  const userCiphertext = uint(tupleField(value, 'userCiphertext', 1, label), `${label} user ciphertext`);
  return uint(decryptUint(userCiphertext, aesKey), `${label} plaintext`);
};

export const confirmDexV2Swap = async ({
  deployment,
  signer,
  submission
}: {
  deployment: AttestedDexV2Deployment;
  signer: JsonRpcSigner;
  submission: DexV2SwapSubmission;
}): Promise<ConfirmedDexV2Swap> => {
  const verified = assertAttestedDexV2Deployment(deployment);
  const expected = submission && SUBMISSIONS.get(submission);
  if (!expected || expected.deployment !== verified || expected.signer !== signer) {
    throw new Error('DEX V2 confirmation requires its exact local submission and wallet lease.');
  }
  const owner = address(await signer.getAddress(), 'DEX V2 receipt owner');
  const confirmation = await confirmedReceipt(submission.transaction);
  const matchingEvents = confirmation.receipt.logs.flatMap((log) => {
    if (address(log.address, 'DEX V2 log address') !== verified.manifest.addresses.core || log.removed) return [];
    try {
      const parsed = SWAP.parseLog({ topics: [...log.topics], data: log.data });
      return parsed?.name === 'DexSwapProcessed' ? [parsed] : [];
    } catch {
      return [];
    }
  }).filter((event) =>
    address(event.args[2], 'DEX V2 event trader') === owner &&
    bytes32(event.args[1], 'DEX V2 event pair') === verified.manifest.pair.pairKey &&
    uint(event.args[3], 'DEX V2 event direction') === BigInt(dexV2DirectionCode(expected.direction))
  );
  if (matchingEvents.length !== 1) {
    throw new Error('DEX V2 receipt must contain exactly one matching swap marker.');
  }
  const event = matchingEvents[0];
  const swapId = uint(event.args[0], 'DEX V2 swap ID');
  if (swapId === 0n) throw new Error('DEX V2 swap ID cannot be zero.');
  const contract = new Contract(verified.manifest.addresses.core, DEX_V2_SWAP_RECEIPT_ABI, signer);
  const privateReceipt = await contract.getMySwapReceipt.staticCall(swapId, {
    blockTag: confirmation.receipt.blockNumber
  });
  if (
    address(tupleField(privateReceipt, 'recipient', 0, 'DEX V2 private receipt'), 'DEX V2 private recipient') !== owner ||
    bytes32(tupleField(privateReceipt, 'pairKey', 1, 'DEX V2 private receipt'), 'DEX V2 private pair') !== verified.manifest.pair.pairKey ||
    uint(tupleField(privateReceipt, 'direction', 2, 'DEX V2 private receipt'), 'DEX V2 private direction') !==
      BigInt(dexV2DirectionCode(expected.direction)) ||
    tupleField(privateReceipt, 'initialized', 3, 'DEX V2 private receipt') !== true
  ) {
    throw new Error('DEX V2 private receipt does not match the confirmed swap.');
  }
  const aesKey = signer.getUserOnboardInfo()?.aesKey?.trim();
  if (!aesKey) throw new Error('Unlock privacy before revealing the DEX swap receipt.');
  const inputUsedLots = decryptUserUint(
    tupleField(privateReceipt, 'inputUsedLots', 4, 'DEX V2 private receipt'),
    aesKey,
    'DEX V2 input-used receipt'
  );
  const outputAmountLots = decryptUserUint(
    tupleField(privateReceipt, 'outputAmountLots', 5, 'DEX V2 private receipt'),
    aesKey,
    'DEX V2 output receipt'
  );
  const unusedInputLots = decryptUserUint(
    tupleField(privateReceipt, 'unusedInputLots', 6, 'DEX V2 private receipt'),
    aesKey,
    'DEX V2 unused-input receipt'
  );
  const invalidValue = decryptUserUint(
    tupleField(privateReceipt, 'invalid', 7, 'DEX V2 private receipt'),
    aesKey,
    'DEX V2 invalid receipt'
  );
  if (invalidValue !== 0n && invalidValue !== 1n) {
    throw new Error('DEX V2 invalid receipt must decrypt to exactly zero or one.');
  }
  const invalid = invalidValue === 1n;
  if (inputUsedLots + unusedInputLots !== expected.maximumInputLots) {
    throw new Error('DEX V2 private receipt does not reconcile with the submitted maximum.');
  }
  if (
    (!invalid && (inputUsedLots === 0n || outputAmountLots === 0n)) ||
    (invalid && (inputUsedLots !== 0n || outputAmountLots !== 0n || unusedInputLots !== expected.maximumInputLots))
  ) {
    throw new Error('DEX V2 private receipt outcome is inconsistent.');
  }
  return Object.freeze({
    swapId: swapId.toString(),
    transactionHash: confirmation.transactionHash,
    blockNumber: confirmation.receipt.blockNumber.toString(),
    blockHash: bytes32(confirmation.receipt.blockHash, 'DEX V2 receipt block hash'),
    direction: expected.direction,
    publicPoolMarginalTick: uint(event.args[4], 'DEX V2 public Pool tick').toString(),
    inputUsedLots: inputUsedLots.toString(),
    outputAmountLots: outputAmountLots.toString(),
    unusedInputLots: unusedInputLots.toString(),
    invalid
  });
};
