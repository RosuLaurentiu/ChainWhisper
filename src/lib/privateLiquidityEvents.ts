import { Interface, getAddress } from 'ethers';
import {
  buildPrivateLiquidityRawEventKey,
  type PrivateLiquidityEventProvenance
} from './privateLiquidityHistory';
import type {
  PrivateLiquidityDirection,
  PrivateLiquidityPositionStatus,
  PrivateLiquiditySideTerms
} from './privateLiquidity';

const PRIVATE_UINT256_TUPLE =
  '((uint256 ciphertextHigh,uint256 ciphertextLow) ciphertext,(uint256 ciphertextHigh,uint256 ciphertextLow) userCiphertext)';

export const PRIVATE_LIQUIDITY_V1_EVENT_ABI = [
  'event Transfer(address indexed from,address indexed to,uint256 indexed tokenId)',
  'event PrivateLiquidityPositionCreated(uint256 indexed positionId,address indexed positionOwner,bytes32 indexed pairKey,address baseToken,address quoteToken,(uint256 baseAmount,uint256 quoteAmount) buyTerms,(uint256 baseAmount,uint256 quoteAmount) sellTerms,uint64 createdAt,uint64 revision)',
  'event PrivateLiquidityPositionTermsUpdated(uint256 indexed positionId,address indexed positionOwner,(uint256 baseAmount,uint256 quoteAmount) buyTerms,(uint256 baseAmount,uint256 quoteAmount) sellTerms,uint64 revision)',
  'event PrivateLiquidityPositionLiquidityChanged(uint256 indexed positionId,address indexed positionOwner,address indexed actor,uint64 revision)',
  'event PrivateLiquidityPositionStatusChanged(uint256 indexed positionId,address indexed positionOwner,uint8 previousStatus,uint8 nextStatus,address actor,uint64 revision)',
  'event PrivateLiquidityPositionTransferActivationRequired(uint256 indexed positionId,address indexed previousOwner,address indexed nextOwner,uint64 revision)',
  'event PrivateLiquidityPositionPrivacyActivated(uint256 indexed positionId,address indexed positionOwner,bool resumed,uint64 revision)',
  'event PrivateLiquidityPositionClosed(uint256 indexed positionId,address indexed positionOwner)',
  `event PrivateLiquidityOwnerInventorySnapshotUpdated(uint256 indexed positionId,address indexed recipient,address indexed actor,uint64 sequence,${PRIVATE_UINT256_TUPLE} baseAmount,${PRIVATE_UINT256_TUPLE} quoteAmount)`,
  `event PrivateLiquidityPositionExecutionReceiptUpdated(uint256 indexed positionId,uint256 indexed swapId,address indexed recipient,uint8 direction,${PRIVATE_UINT256_TUPLE} baseAmount,${PRIVATE_UINT256_TUPLE} quoteAmount)`,
  `event PrivateLiquidityTraderSwapReceiptUpdated(uint256 indexed swapId,address indexed recipient,bytes32 indexed pairKey,uint8 direction,${PRIVATE_UINT256_TUPLE} inputAmount,${PRIVATE_UINT256_TUPLE} outputAmount,${PRIVATE_UINT256_TUPLE} unusedInputAmount)`,
  'event PrivateLiquiditySwapExecuted(uint256 indexed swapId,address indexed trader,bytes32 indexed pairKey,uint8 direction,uint256 candidateCount)'
] as const;

const EVENT_INTERFACE = new Interface(PRIVATE_LIQUIDITY_V1_EVENT_ABI);
const HEX_BYTES_PATTERN = /^0x(?:[0-9a-fA-F]{2})*$/;
const BYTES32_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

export type PrivateLiquidityV1RawLog = Readonly<{
  chainId: string;
  address: string;
  blockNumber: string;
  blockHash: string;
  transactionHash: string;
  transactionIndex: number;
  logIndex: number;
  removed: false;
  topics: readonly string[];
  data: string;
}>;

export type PrivateLiquidityEncryptedUint256 = Readonly<{
  ciphertextHigh: string;
  ciphertextLow: string;
  userCiphertextHigh: string;
  userCiphertextLow: string;
}>;

type ParsedBase = Readonly<{
  provenance: PrivateLiquidityEventProvenance;
  rawEventKey: string;
}>;

export type ParsedPrivateLiquidityV1Log =
  | (ParsedBase &
      Readonly<{
        kind: 'position-created';
        positionId: string;
        positionOwner: string;
        pairKey: string;
        baseToken: string;
        quoteToken: string;
        buyTerms: PrivateLiquiditySideTerms;
        sellTerms: PrivateLiquiditySideTerms;
        createdAt: string;
        revision: string;
      }>)
  | (ParsedBase &
      Readonly<{
        kind: 'position-terms-updated';
        positionId: string;
        positionOwner: string;
        buyTerms: PrivateLiquiditySideTerms;
        sellTerms: PrivateLiquiditySideTerms;
        revision: string;
      }>)
  | (ParsedBase &
      Readonly<{
        kind: 'position-liquidity-changed';
        positionId: string;
        positionOwner: string;
        actor: string;
        revision: string;
      }>)
  | (ParsedBase &
      Readonly<{
        kind: 'position-status-changed';
        positionId: string;
        positionOwner: string;
        previousStatus: PrivateLiquidityPositionStatus;
        nextStatus: PrivateLiquidityPositionStatus;
        actor: string;
        revision: string;
      }>)
  | (ParsedBase &
      Readonly<{
        kind: 'position-transfer-activation-required';
        positionId: string;
        previousOwner: string;
        nextOwner: string;
        revision: string;
      }>)
  | (ParsedBase &
      Readonly<{
        kind: 'position-privacy-activated';
        positionId: string;
        positionOwner: string;
        resumed: boolean;
        revision: string;
      }>)
  | (ParsedBase &
      Readonly<{
        kind: 'position-closed';
        positionId: string;
        positionOwner: string;
      }>)
  | (ParsedBase &
      Readonly<{
        kind: 'position-owner-inventory';
        positionId: string;
        recipient: string;
        actor: string;
        sequence: string;
        baseAmount: PrivateLiquidityEncryptedUint256;
        quoteAmount: PrivateLiquidityEncryptedUint256;
      }>)
  | (ParsedBase &
      Readonly<{
        kind: 'position-execution-receipt';
        positionId: string;
        swapId: string;
        recipient: string;
        direction: PrivateLiquidityDirection;
        baseAmount: PrivateLiquidityEncryptedUint256;
        quoteAmount: PrivateLiquidityEncryptedUint256;
      }>)
  | (ParsedBase &
      Readonly<{
        kind: 'trader-swap-receipt';
        swapId: string;
        recipient: string;
        pairKey: string;
        direction: PrivateLiquidityDirection;
        inputAmount: PrivateLiquidityEncryptedUint256;
        outputAmount: PrivateLiquidityEncryptedUint256;
        unusedInputAmount: PrivateLiquidityEncryptedUint256;
      }>)
  | (ParsedBase &
      Readonly<{
        kind: 'swap-executed';
        swapId: string;
        trader: string;
        pairKey: string;
        direction: PrivateLiquidityDirection;
        candidateCount: number;
      }>)
  | (ParsedBase &
      Readonly<{
        kind: 'position-transfer';
        from: string;
        to: string;
        positionId: string;
      }>);

const canonicalAddress = (value: unknown, label: string, allowZero = false): string => {
  if (typeof value !== 'string' || value !== value.trim()) {
    throw new Error(`${label} must be a canonical address.`);
  }
  let normalized: string;
  try {
    normalized = getAddress(value).toLowerCase();
  } catch {
    throw new Error(`${label} must be a canonical address.`);
  }
  if (!allowZero && normalized === ZERO_ADDRESS) throw new Error(`${label} cannot be zero.`);
  return normalized;
};

const canonicalBytes32 = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || !BYTES32_PATTERN.test(value)) {
    throw new Error(`${label} must be bytes32.`);
  }
  return value.toLowerCase();
};

const uint = (value: unknown, label: string, maximum?: bigint): string => {
  let parsed: bigint;
  try {
    parsed = BigInt(value as bigint);
  } catch {
    throw new Error(`${label} must be an unsigned integer.`);
  }
  if (parsed < 0n || (maximum !== undefined && parsed > maximum)) {
    throw new Error(`${label} is out of range.`);
  }
  return parsed.toString();
};

const safeNumber = (value: unknown, label: string, maximum: number): number => {
  const parsed = BigInt(uint(value, label, BigInt(maximum)));
  return Number(parsed);
};

const direction = (value: unknown): PrivateLiquidityDirection => {
  const parsed = safeNumber(value, 'Swap direction', 1);
  return parsed === 0 ? 'base-to-quote' : 'quote-to-base';
};

const status = (value: unknown, label: string): PrivateLiquidityPositionStatus => {
  const parsed = safeNumber(value, label, 3);
  if (parsed === 1) return 'active';
  if (parsed === 2) return 'paused';
  if (parsed === 3) return 'closed';
  throw new Error(`${label} cannot be None.`);
};

const sideTerms = (value: unknown, label: string): PrivateLiquiditySideTerms => {
  if (!value || typeof value !== 'object') throw new Error(`${label} are malformed.`);
  const tuple = value as { 0?: unknown; 1?: unknown };
  const baseAmount = uint(tuple[0], `${label} base amount`);
  const quoteAmount = uint(tuple[1], `${label} quote amount`);
  if (baseAmount === '0' || quoteAmount === '0') throw new Error(`${label} must be positive.`);
  return Object.freeze({ baseAmount, quoteAmount });
};

const encryptedUint256 = (value: unknown, label: string): PrivateLiquidityEncryptedUint256 => {
  if (!value || typeof value !== 'object') throw new Error(`${label} is malformed.`);
  const tuple = value as { 0?: { 0?: unknown; 1?: unknown }; 1?: { 0?: unknown; 1?: unknown } };
  if (!tuple[0] || !tuple[1]) throw new Error(`${label} is malformed.`);
  return Object.freeze({
    ciphertextHigh: uint(tuple[0][0], `${label} ciphertext high`),
    ciphertextLow: uint(tuple[0][1], `${label} ciphertext low`),
    userCiphertextHigh: uint(tuple[1][0], `${label} user ciphertext high`),
    userCiphertextLow: uint(tuple[1][1], `${label} user ciphertext low`)
  });
};

const provenanceFromRaw = (raw: PrivateLiquidityV1RawLog): PrivateLiquidityEventProvenance => {
  if (raw.removed !== false) throw new Error('Removed logs are discovery hints, not canonical events.');
  if (!HEX_BYTES_PATTERN.test(raw.data)) throw new Error('Event data must be canonical hex bytes.');
  if (!Array.isArray(raw.topics) || raw.topics.length === 0) throw new Error('Event topics are missing.');
  raw.topics.forEach((topic, index) => canonicalBytes32(topic, `Event topic ${index}`));
  const provenance = Object.freeze({
    chainId: uint(raw.chainId, 'Event chain ID'),
    contractAddress: canonicalAddress(raw.address, 'Event contract'),
    blockNumber: uint(raw.blockNumber, 'Event block number'),
    blockHash: canonicalBytes32(raw.blockHash, 'Event block hash'),
    transactionHash: canonicalBytes32(raw.transactionHash, 'Event transaction hash'),
    transactionIndex: safeNumber(raw.transactionIndex, 'Event transaction index', Number.MAX_SAFE_INTEGER),
    logIndex: safeNumber(raw.logIndex, 'Event log index', Number.MAX_SAFE_INTEGER)
  });
  buildPrivateLiquidityRawEventKey(provenance);
  return provenance;
};

export const parsePrivateLiquidityV1Log = (
  raw: PrivateLiquidityV1RawLog
): ParsedPrivateLiquidityV1Log => {
  const provenance = provenanceFromRaw(raw);
  let parsed: ReturnType<Interface['parseLog']>;
  try {
    parsed = EVENT_INTERFACE.parseLog({ topics: [...raw.topics], data: raw.data });
  } catch {
    throw new Error('Log is not a canonical PrivateLiquidityBookV1 event.');
  }
  if (!parsed) throw new Error('Log is not a canonical PrivateLiquidityBookV1 event.');
  const args = parsed.args;
  const base = {
    provenance,
    rawEventKey: buildPrivateLiquidityRawEventKey(provenance)
  } as const;

  switch (parsed.name) {
    case 'Transfer':
      return Object.freeze({
        ...base,
        kind: 'position-transfer',
        from: canonicalAddress(args[0], 'Transfer from', true),
        to: canonicalAddress(args[1], 'Transfer to', true),
        positionId: uint(args[2], 'Transfer position ID')
      });
    case 'PrivateLiquidityPositionCreated':
      return Object.freeze({
        ...base,
        kind: 'position-created',
        positionId: uint(args[0], 'Created position ID'),
        positionOwner: canonicalAddress(args[1], 'Created position owner'),
        pairKey: canonicalBytes32(args[2], 'Created pair key'),
        baseToken: canonicalAddress(args[3], 'Created base token'),
        quoteToken: canonicalAddress(args[4], 'Created quote token'),
        buyTerms: sideTerms(args[5], 'Created buy terms'),
        sellTerms: sideTerms(args[6], 'Created sell terms'),
        createdAt: uint(args[7], 'Created timestamp', (1n << 64n) - 1n),
        revision: uint(args[8], 'Created revision', (1n << 64n) - 1n)
      });
    case 'PrivateLiquidityPositionTermsUpdated':
      return Object.freeze({
        ...base,
        kind: 'position-terms-updated',
        positionId: uint(args[0], 'Terms position ID'),
        positionOwner: canonicalAddress(args[1], 'Terms position owner'),
        buyTerms: sideTerms(args[2], 'Updated buy terms'),
        sellTerms: sideTerms(args[3], 'Updated sell terms'),
        revision: uint(args[4], 'Terms revision', (1n << 64n) - 1n)
      });
    case 'PrivateLiquidityPositionLiquidityChanged':
      return Object.freeze({
        ...base,
        kind: 'position-liquidity-changed',
        positionId: uint(args[0], 'Liquidity position ID'),
        positionOwner: canonicalAddress(args[1], 'Liquidity position owner'),
        actor: canonicalAddress(args[2], 'Liquidity actor'),
        revision: uint(args[3], 'Liquidity revision', (1n << 64n) - 1n)
      });
    case 'PrivateLiquidityPositionStatusChanged':
      return Object.freeze({
        ...base,
        kind: 'position-status-changed',
        positionId: uint(args[0], 'Status position ID'),
        positionOwner: canonicalAddress(args[1], 'Status position owner'),
        previousStatus: status(args[2], 'Previous position status'),
        nextStatus: status(args[3], 'Next position status'),
        actor: canonicalAddress(args[4], 'Status actor'),
        revision: uint(args[5], 'Status revision', (1n << 64n) - 1n)
      });
    case 'PrivateLiquidityPositionTransferActivationRequired':
      return Object.freeze({
        ...base,
        kind: 'position-transfer-activation-required',
        positionId: uint(args[0], 'Transfer position ID'),
        previousOwner: canonicalAddress(args[1], 'Previous position owner'),
        nextOwner: canonicalAddress(args[2], 'Next position owner'),
        revision: uint(args[3], 'Transfer revision', (1n << 64n) - 1n)
      });
    case 'PrivateLiquidityPositionPrivacyActivated':
      return Object.freeze({
        ...base,
        kind: 'position-privacy-activated',
        positionId: uint(args[0], 'Activation position ID'),
        positionOwner: canonicalAddress(args[1], 'Activation position owner'),
        resumed: Boolean(args[2]),
        revision: uint(args[3], 'Activation revision', (1n << 64n) - 1n)
      });
    case 'PrivateLiquidityPositionClosed':
      return Object.freeze({
        ...base,
        kind: 'position-closed',
        positionId: uint(args[0], 'Closed position ID'),
        positionOwner: canonicalAddress(args[1], 'Closed position owner')
      });
    case 'PrivateLiquidityOwnerInventorySnapshotUpdated':
      return Object.freeze({
        ...base,
        kind: 'position-owner-inventory',
        positionId: uint(args[0], 'Inventory position ID'),
        recipient: canonicalAddress(args[1], 'Inventory recipient'),
        actor: canonicalAddress(args[2], 'Inventory actor'),
        sequence: uint(args[3], 'Inventory sequence', (1n << 64n) - 1n),
        baseAmount: encryptedUint256(args[4], 'Inventory base amount'),
        quoteAmount: encryptedUint256(args[5], 'Inventory quote amount')
      });
    case 'PrivateLiquidityPositionExecutionReceiptUpdated':
      return Object.freeze({
        ...base,
        kind: 'position-execution-receipt',
        positionId: uint(args[0], 'Receipt position ID'),
        swapId: uint(args[1], 'Receipt swap ID'),
        recipient: canonicalAddress(args[2], 'Position receipt recipient'),
        direction: direction(args[3]),
        baseAmount: encryptedUint256(args[4], 'Receipt base amount'),
        quoteAmount: encryptedUint256(args[5], 'Receipt quote amount')
      });
    case 'PrivateLiquidityTraderSwapReceiptUpdated':
      return Object.freeze({
        ...base,
        kind: 'trader-swap-receipt',
        swapId: uint(args[0], 'Trader receipt swap ID'),
        recipient: canonicalAddress(args[1], 'Trader receipt recipient'),
        pairKey: canonicalBytes32(args[2], 'Trader receipt pair key'),
        direction: direction(args[3]),
        inputAmount: encryptedUint256(args[4], 'Trader input amount'),
        outputAmount: encryptedUint256(args[5], 'Trader output amount'),
        unusedInputAmount: encryptedUint256(args[6], 'Trader unused input amount')
      });
    case 'PrivateLiquiditySwapExecuted': {
      const candidateCount = safeNumber(args[4], 'Swap candidate count', 8);
      if (candidateCount === 0) throw new Error('Swap candidate count must be positive.');
      return Object.freeze({
        ...base,
        kind: 'swap-executed',
        swapId: uint(args[0], 'Swap ID'),
        trader: canonicalAddress(args[1], 'Swap trader'),
        pairKey: canonicalBytes32(args[2], 'Swap pair key'),
        direction: direction(args[3]),
        candidateCount
      });
    }
    default:
      throw new Error('Unsupported PrivateLiquidityBookV1 event.');
  }
};
