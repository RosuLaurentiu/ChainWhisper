import { Interface, getAddress } from '@coti-io/coti-ethers';
import { PRIVATE_BOOK_V2_RUNTIME_HASH, isPrivateBookV2RuntimeHash } from './currentP2PBinding';
import {
  normalizeTradeHistoryV2Observation,
  type TradeHistoryV2Amounts,
  type TradeHistoryV2LogRef,
  type TradeHistoryV2Observation,
  type TradeHistoryV2Protocol,
  type TradeHistoryV2Side
} from './tradeHistoryV2Ledger';

const STANDARD_ABI = [
  'event StandardTradeOpened(uint256 indexed tradeId,address indexed maker,bytes32 indexed pairKey,uint8 offerAssetType,address offerToken,uint256 offerAmount,uint8 requestAssetType,address requestToken,uint256 requestAmount,(bool partialFillsAllowed,uint16 minPartialFillBps,uint256 minRequestAmount,uint256 maxRequestAmountPerWallet,bool oneFillPerWallet) fillPolicy,uint64 createdAt,uint64 expiresAt,uint64 revision,uint256 rootTradeId)',
  'event StandardTradeFilled(uint256 indexed tradeId,address indexed filler,address indexed maker,uint256 requestAmountIn,uint256 offerAmountOut,uint256 remainingOfferAmount,uint256 remainingRequestAmount,uint64 nextRevision,bool finalFill)',
  'event StandardTradeStatusChanged(uint256 indexed tradeId,address indexed maker,uint8 previousStatus,uint8 nextStatus,address actor,uint256 relatedTradeId,uint64 revision)',
  'event StandardTradeReplaced(uint256 indexed originalTradeId,uint256 indexed replacementTradeId,uint256 indexed rootTradeId)'
] as const;

const PRIVATE_ABI = [
  'event PrivateOrderOpened(uint256 indexed orderId,address indexed maker,bytes32 indexed pairKey,uint8 mode,uint8 offerAssetType,address offerToken,uint256 publicOfferAmount,uint8 requestAssetType,address requestToken,uint256 publicRequestAmount,(bool partialFillsAllowed,uint16 minPartialFillBps,uint8 maxFills) fillPolicy,uint64 createdAt,uint64 expiresAt,uint64 revision,uint256 rootOrderId)',
  'event PrivateOrderFilled(uint256 indexed orderId,address indexed filler,address indexed maker,uint8 mode,uint64 nextRevision,uint8 fillCount,bool finalFill,uint256 publicOfferAmount,uint256 publicRequestAmount)',
  'event PrivateOrderAccountSnapshotUpdated(uint256 indexed orderId,address indexed recipient,address indexed actor,uint64 sequence,((uint256 ciphertextHigh,uint256 ciphertextLow) ciphertext,(uint256 ciphertextHigh,uint256 ciphertextLow) userCiphertext) totalOfferAmount,((uint256 ciphertextHigh,uint256 ciphertextLow) ciphertext,(uint256 ciphertextHigh,uint256 ciphertextLow) userCiphertext) totalRequestAmount,((uint256 ciphertextHigh,uint256 ciphertextLow) ciphertext,(uint256 ciphertextHigh,uint256 ciphertextLow) userCiphertext) remainingOfferAmount,((uint256 ciphertextHigh,uint256 ciphertextLow) ciphertext,(uint256 ciphertextHigh,uint256 ciphertextLow) userCiphertext) lastOfferAmount,((uint256 ciphertextHigh,uint256 ciphertextLow) ciphertext,(uint256 ciphertextHigh,uint256 ciphertextLow) userCiphertext) lastRequestAmount)',
  'event PrivateOrderStatusChanged(uint256 indexed orderId,address indexed maker,uint8 previousStatus,uint8 nextStatus,address actor,uint256 relatedOrderId,uint64 revision)',
  'event PrivateOrderReplaced(uint256 indexed originalOrderId,uint256 indexed replacementOrderId,uint256 indexed rootOrderId)'
] as const;

export const PRIVATE_BOOK_V2_HISTORY_RUNTIME_HASH = PRIVATE_BOOK_V2_RUNTIME_HASH;
const PRIVATE_LEGACY_RUNTIME_HASH = '0xe20848f75e59634a16c7d33dd393e91698292a9b29400d456ff57ab0c04ac680';
const PRIVATE_PUBLIC_PRICE_ABI = [
  'event PrivateOrderOpened(uint256 indexed orderId,address indexed maker,bytes32 indexed pairKey,uint8 mode,uint8 offerAssetType,address offerToken,uint256 publicOfferAmount,uint8 requestAssetType,address requestToken,uint256 publicRequestAmount,(uint128 offerAmount,uint128 requestAmount) priceTerms,(bool partialFillsAllowed,uint16 minPartialFillBps,uint8 maxFills) fillPolicy,uint64 createdAt,uint64 expiresAt,uint64 revision,uint256 rootOrderId)',
  'event PrivateOrderFilled(uint256 indexed orderId,address indexed filler,address indexed maker,uint8 mode,uint64 nextRevision,uint64 fillCount,uint256 publicOfferAmount,uint256 publicRequestAmount)',
  ...PRIVATE_ABI.slice(2)
] as const;
const PRIVATE_PUBLIC_PRICE_INTERFACE = new Interface(PRIVATE_PUBLIC_PRICE_ABI);

const RECURRING_ABI = [
  'event RecurringOrderOpened(uint256 indexed orderId,address indexed maker,bytes32 indexed pairKey,uint8 baseAssetType,address baseToken,uint8 quoteAssetType,address quoteToken,(uint256 baseAmount,uint256 quoteAmount) buyTerms,(uint256 baseAmount,uint256 quoteAmount) sellTerms,uint256 baseInventory,uint256 quoteInventory,uint64 createdAt,uint64 expiresAt,uint64 revision)',
  'event RecurringOrderEdited(uint256 indexed orderId,address indexed maker,(uint256 baseAmount,uint256 quoteAmount) buyTerms,(uint256 baseAmount,uint256 quoteAmount) sellTerms,uint256 baseAdded,uint256 quoteAdded,uint256 baseRemoved,uint256 quoteRemoved,uint256 baseInventory,uint256 quoteInventory,uint64 expiresAt,uint64 nextRevision)',
  'event RecurringOrderExecuted(uint256 indexed orderId,address indexed filler,address indexed maker,uint8 side,uint64 executionIndex,uint64 nextRevision,uint256 baseAmount,uint256 quoteAmount,uint256 baseInventory,uint256 quoteInventory)',
  'event RecurringOrderStatusChanged(uint256 indexed orderId,address indexed maker,uint8 previousStatus,uint8 nextStatus,address actor,uint64 nextRevision)',
  'event RecurringInventorySettled(uint256 indexed orderId,address indexed maker,uint256 baseAmount,uint256 quoteAmount)'
] as const;

const PRIVATE_RECURRING_ABI = [
  'event PrivateRecurringOrderOpened(uint256 indexed orderId,address indexed maker,bytes32 indexed pairKey,address baseToken,address quoteToken,(uint256 baseAmount,uint256 quoteAmount) buyTerms,(uint256 baseAmount,uint256 quoteAmount) sellTerms,uint64 createdAt,uint64 expiresAt,uint64 revision)',
  'event PrivateRecurringOrderEdited(uint256 indexed orderId,address indexed maker,(uint256 baseAmount,uint256 quoteAmount) buyTerms,(uint256 baseAmount,uint256 quoteAmount) sellTerms,bool liquidityChanged,uint64 expiresAt,uint64 nextRevision)',
  'event PrivateRecurringOrderExecuted(uint256 indexed orderId,address indexed filler,address indexed maker,uint8 side,uint64 executionIndex,uint64 nextRevision)',
  'event PrivateRecurringExecutionReceiptUpdated(uint256 indexed orderId,address indexed recipient,address indexed filler,uint8 side,uint64 executionIndex,((uint256 ciphertextHigh,uint256 ciphertextLow) ciphertext,(uint256 ciphertextHigh,uint256 ciphertextLow) userCiphertext) baseAmount,((uint256 ciphertextHigh,uint256 ciphertextLow) ciphertext,(uint256 ciphertextHigh,uint256 ciphertextLow) userCiphertext) quoteAmount)',
  'event PrivateRecurringOrderStatusChanged(uint256 indexed orderId,address indexed maker,uint8 previousStatus,uint8 nextStatus,address actor,uint64 nextRevision)',
  'event PrivateRecurringInventorySettled(uint256 indexed orderId,address indexed maker)'
] as const;

const DIRECT_ABI = [
  'event DirectTradeOpened(uint256 indexed tradeId,address indexed maker,address indexed taker,address parentEscrow,uint256 parentTradeId,uint256 rootTradeId,uint8 counterDepth,uint8 offerAssetType,address offerToken,uint8 requestAssetType,address requestToken,uint8 amountMode,uint256 publicOfferAmount,uint256 publicRequestAmount,uint64 createdAt,uint64 expiresAt)',
  'event DirectTradeStatusChanged(uint256 indexed tradeId,address indexed maker,address indexed taker,uint8 previousStatus,uint8 nextStatus,address actor,uint256 relatedTradeId,uint64 changedAt)',
  'event DirectTradeReplaced(uint256 indexed originalTradeId,uint256 indexed replacementTradeId,uint256 indexed rootTradeId)'
] as const;

const INTERFACES = {
  'standard-v2': new Interface(STANDARD_ABI),
  'private-v2': new Interface(PRIVATE_ABI),
  'recurring-v2': new Interface(RECURRING_ABI),
  'private-recurring-v2': new Interface(PRIVATE_RECURRING_ABI),
  'direct-v2': new Interface(DIRECT_ABI)
} as const;

const EVENT_NAMES = {
  'standard-v2': new Set(['StandardTradeOpened', 'StandardTradeFilled', 'StandardTradeStatusChanged', 'StandardTradeReplaced']),
  'private-v2': new Set(['PrivateOrderOpened', 'PrivateOrderFilled', 'PrivateOrderAccountSnapshotUpdated', 'PrivateOrderStatusChanged', 'PrivateOrderReplaced']),
  'recurring-v2': new Set(['RecurringOrderOpened', 'RecurringOrderEdited', 'RecurringOrderExecuted', 'RecurringOrderStatusChanged', 'RecurringInventorySettled']),
  'private-recurring-v2': new Set([
    'PrivateRecurringOrderOpened',
    'PrivateRecurringOrderEdited',
    'PrivateRecurringOrderExecuted',
    'PrivateRecurringExecutionReceiptUpdated',
    'PrivateRecurringOrderStatusChanged',
    'PrivateRecurringInventorySettled'
  ]),
  'direct-v2': new Set(['DirectTradeOpened', 'DirectTradeStatusChanged', 'DirectTradeReplaced'])
} as const;

const UINT64_MAX = (1n << 64n) - 1n;
const UINT256_MAX = (1n << 256n) - 1n;
const ZERO_BYTES32 = `0x${'00'.repeat(32)}`;

export type TradeHistoryV2EventProtocol = TradeHistoryV2Protocol;

/** Undefined identity is retained only for standalone legacy decoding. Canonical readers supply it. */
export const getTradeHistoryV2EventInterface = (
  protocol: TradeHistoryV2EventProtocol,
  runtimeBytecodeHash?: string
): Interface => {
  if (protocol !== 'private-v2') return INTERFACES[protocol];
  if (runtimeBytecodeHash === undefined) return INTERFACES[protocol];
  const hash = runtimeBytecodeHash.toLowerCase();
  if (isPrivateBookV2RuntimeHash(hash)) return PRIVATE_PUBLIC_PRICE_INTERFACE;
  if (hash === PRIVATE_LEGACY_RUNTIME_HASH) return INTERFACES[protocol];
  throw new Error('Private trade history runtime has no admitted event ABI.');
};

export type TradeHistoryV2RawLog = Readonly<{
  address: string;
  topics: readonly string[];
  data: string;
  blockNumber: string;
  blockHash: string;
  transactionHash: string;
  transactionIndex: string;
  logIndex: string;
  removed: boolean;
}>;

export type ParsedTradeHistoryV2Execution = Readonly<{
  kind: 'execution';
  observation: TradeHistoryV2Observation;
  contractRevision: string;
}>;

export type ParsedTradeHistoryV2PrivateReceipt = Readonly<{
  kind: 'encrypted-receipt';
  protocol: 'private-v2' | 'private-recurring-v2';
  chainId: string;
  contractAddress: string;
  orderId: string;
  recipient: string;
  participant: string;
  side: TradeHistoryV2Side;
  executionSequence?: string;
  contractRevision?: string;
  encryptedAmounts: Readonly<{
    offerAmount?: ParsedTradeHistoryV2EncryptedUint256;
    requestAmount?: ParsedTradeHistoryV2EncryptedUint256;
    baseAmount?: ParsedTradeHistoryV2EncryptedUint256;
    quoteAmount?: ParsedTradeHistoryV2EncryptedUint256;
  }>;
  log: TradeHistoryV2LogRef;
}>;

export type ParsedTradeHistoryV2EncryptedUint256 = Readonly<{
  ciphertextHigh: string;
  ciphertextLow: string;
  userCiphertextHigh: string;
  userCiphertextLow: string;
}>;

export type ParsedDirectTradeV2Opened = Readonly<{
  kind: 'direct-opened';
  protocol: 'direct-v2';
  chainId: string;
  contractAddress: string;
  orderId: string;
  maker: string;
  taker: string;
  parentEscrow: string;
  parentTradeId: string;
  rootTradeId: string;
  counterDepth: string;
  offerAssetType: '0' | '1' | '2';
  offerToken: string;
  requestAssetType: '0' | '1' | '2';
  requestToken: string;
  amountMode: 'public' | 'private';
  publicAmounts: TradeHistoryV2Amounts;
  createdAt: string;
  expiresAt: string;
  log: TradeHistoryV2LogRef;
}>;

export type ParsedDirectTradeV2Status = Readonly<{
  kind: 'direct-status';
  protocol: 'direct-v2';
  chainId: string;
  contractAddress: string;
  orderId: string;
  maker: string;
  taker: string;
  previousStatus: string;
  nextStatus: string;
  actor: string;
  relatedOrderId: string;
  changedAt: string;
  log: TradeHistoryV2LogRef;
}>;

export type ParsedTradeHistoryV2Lifecycle = Readonly<{
  kind: 'lifecycle';
  lifecycleKind: 'opened' | 'edited' | 'replacement' | 'status' | 'settlement';
  protocol: TradeHistoryV2Protocol;
  chainId: string;
  contractAddress: string;
  orderId: string;
  maker?: string;
  previousStatus?: string;
  nextStatus?: string;
  actor?: string;
  relatedOrderId?: string;
  replacementOrderId?: string;
  rootOrderId?: string;
  createdAt?: string;
  expiresAt?: string;
  contractRevision?: string;
  publicPriceTerms?: Readonly<{ offerAmount: string; requestAmount: string }>;
  editAmounts?: Readonly<{
    baseAdded: string;
    quoteAdded: string;
    baseRemoved: string;
    quoteRemoved: string;
  }>;
  liquidityChanged?: boolean;
  settledAmounts?: Readonly<{ baseAmount: string; quoteAmount: string }>;
  log: TradeHistoryV2LogRef;
}>;

export type ParsedTradeHistoryV2Log =
  | ParsedTradeHistoryV2Execution
  | ParsedTradeHistoryV2PrivateReceipt
  | ParsedDirectTradeV2Opened
  | ParsedDirectTradeV2Status
  | ParsedTradeHistoryV2Lifecycle;

type ParsedArgs = Record<string, unknown>;

const decimal = (value: unknown, label: string, maximum = UINT256_MAX): string => {
  let parsed: bigint;
  try {
    parsed = BigInt(value as bigint | number | string);
  } catch {
    throw new Error(`${label} is not an unsigned integer.`);
  }
  if (parsed < 0n || parsed > maximum) throw new Error(`${label} is out of range.`);
  return parsed.toString();
};

const canonicalQuantity = (value: unknown, label: string): bigint => {
  if (typeof value !== 'string' || !/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/.test(value)) {
    throw new Error(`${label} must be a canonical JSON-RPC quantity.`);
  }
  return BigInt(value);
};

const bytes32 = (value: unknown, label: string): string => {
  if (
    typeof value !== 'string' ||
    !/^0x[0-9a-fA-F]{64}$/.test(value) ||
    value.toLowerCase() === ZERO_BYTES32
  ) {
    throw new Error(`${label} must be non-zero bytes32 hex.`);
  }
  return value.toLowerCase();
};

const hexBytes = (value: unknown, label: string, allowEmpty: boolean): string => {
  if (typeof value !== 'string' || !/^0x(?:[0-9a-fA-F]{2})*$/.test(value)) {
    throw new Error(`${label} must be canonical hex bytes.`);
  }
  if (!allowEmpty && value === '0x') throw new Error(`${label} cannot be empty.`);
  return value.toLowerCase();
};

const address = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || value !== value.trim()) throw new Error(`${label} is invalid.`);
  return getAddress(value).toLowerCase();
};

const safeIndex = (value: bigint, label: string): number => {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error(`${label} exceeds JavaScript's safe range.`);
  return Number(value);
};

const side = (value: unknown, label: string): 'buy' | 'sell' => {
  const parsed = decimal(value, label, 1n);
  return parsed === '0' ? 'buy' : 'sell';
};

const assetType = (value: unknown, label: string): '0' | '1' | '2' =>
  decimal(value, label, 2n) as '0' | '1' | '2';

const boolean = (value: unknown, label: string): boolean => {
  if (typeof value !== 'boolean') throw new Error(`${label} must be boolean.`);
  return value;
};

const encryptedUint256 = (value: unknown, label: string): ParsedTradeHistoryV2EncryptedUint256 => {
  if (!value || typeof value !== 'object') throw new Error(`${label} is malformed.`);
  const wrapped = value as Record<string | number, unknown>;
  const ciphertext = wrapped.ciphertext ?? wrapped[0];
  const userCiphertext = wrapped.userCiphertext ?? wrapped[1];
  if (!ciphertext || typeof ciphertext !== 'object' || !userCiphertext || typeof userCiphertext !== 'object') {
    throw new Error(`${label} is missing ciphertext fields.`);
  }
  const authenticated = ciphertext as Record<string | number, unknown>;
  const recipient = userCiphertext as Record<string | number, unknown>;
  return Object.freeze({
    ciphertextHigh: decimal(authenticated.ciphertextHigh ?? authenticated[0], `${label} authenticated high`),
    ciphertextLow: decimal(authenticated.ciphertextLow ?? authenticated[1], `${label} authenticated low`),
    userCiphertextHigh: decimal(recipient.ciphertextHigh ?? recipient[0], `${label} user high`),
    userCiphertextLow: decimal(recipient.ciphertextLow ?? recipient[1], `${label} user low`)
  });
};

const normalizeRawLog = (
  raw: TradeHistoryV2RawLog,
  expectedContractAddress: string
): Readonly<{ raw: TradeHistoryV2RawLog; log: TradeHistoryV2LogRef }> => {
  const contractAddress = address(expectedContractAddress, 'Expected trade contract address');
  if (address(raw.address, 'Trade log address') !== contractAddress) {
    throw new Error('Trade log address does not match the expected contract.');
  }
  if (raw.removed !== false) throw new Error('Removed trade logs cannot enter canonical history.');
  if (!Array.isArray(raw.topics) || raw.topics.length === 0) throw new Error('Trade log topics are missing.');
  const topics = raw.topics.map((topic, index) => bytes32(topic, `Trade log topic ${index}`));
  const blockNumber = canonicalQuantity(raw.blockNumber, 'Trade log block number');
  const transactionIndex = canonicalQuantity(raw.transactionIndex, 'Trade log transaction index');
  const logIndex = canonicalQuantity(raw.logIndex, 'Trade log index');
  return {
    raw: {
      ...raw,
      address: contractAddress,
      topics,
      data: hexBytes(raw.data, 'Trade log data', true),
      blockHash: bytes32(raw.blockHash, 'Trade log block hash'),
      transactionHash: bytes32(raw.transactionHash, 'Trade log transaction hash')
    },
    log: {
      blockNumber: blockNumber.toString(),
      blockHash: bytes32(raw.blockHash, 'Trade log block hash'),
      transactionHash: bytes32(raw.transactionHash, 'Trade log transaction hash'),
      transactionIndex: safeIndex(transactionIndex, 'Trade log transaction index'),
      logIndex: safeIndex(logIndex, 'Trade log index')
    }
  };
};

const parseDescription = (
  protocol: TradeHistoryV2EventProtocol,
  raw: TradeHistoryV2RawLog,
  runtimeBytecodeHash?: string
): Readonly<{ name: string; args: ParsedArgs }> | undefined => {
  const abi = getTradeHistoryV2EventInterface(protocol, runtimeBytecodeHash);
  let description;
  try {
    description = abi.parseLog({ topics: [...raw.topics], data: raw.data });
  } catch {
    return undefined;
  }
  if (!description || !EVENT_NAMES[protocol].has(description.name as never)) return undefined;
  return { name: description.name, args: description.args as unknown as ParsedArgs };
};

const execution = ({
  protocol,
  chainId,
  contractAddress,
  orderId,
  sequence,
  contractRevision,
  maker,
  participant,
  side: executionSide,
  source,
  amounts,
  postState,
  log
}: {
  protocol: TradeHistoryV2EventProtocol;
  chainId: string;
  contractAddress: string;
  orderId: string;
  sequence: string;
  contractRevision: string;
  maker: string;
  participant: string;
  side: TradeHistoryV2Side;
  source: 'public-event' | 'private-marker';
  amounts: TradeHistoryV2Amounts;
  postState?: TradeHistoryV2Observation['postState'];
  log: TradeHistoryV2LogRef;
}): ParsedTradeHistoryV2Execution => Object.freeze({
  kind: 'execution',
  contractRevision: decimal(contractRevision, 'Trade execution contract revision', UINT64_MAX),
  observation: normalizeTradeHistoryV2Observation({
    schema: 1,
    protocol,
    order: { chainId, contractAddress, orderId },
    sequence,
    maker,
    participant,
    side: executionSide,
    source,
    amounts,
    postState,
    log
  })
});

export const parseTradeHistoryV2Log = ({
  protocol,
  chainId,
  contractAddress,
  runtimeBytecodeHash,
  log: untrustedLog
}: {
  protocol: TradeHistoryV2EventProtocol;
  chainId: string;
  contractAddress: string;
  runtimeBytecodeHash?: string;
  log: TradeHistoryV2RawLog;
}): ParsedTradeHistoryV2Log | undefined => {
  const normalized = normalizeRawLog(untrustedLog, contractAddress);
  const description = parseDescription(protocol, normalized.raw, runtimeBytecodeHash);
  if (!description) return undefined;
  const args = description.args;

  if (description.name === 'StandardTradeFilled') {
    const nextRevision = decimal(args.nextRevision, 'Standard fill revision', UINT64_MAX);
    const sequence = BigInt(nextRevision) - 1n;
    if (sequence <= 0n) throw new Error('Standard fill revision cannot encode execution zero.');
    return execution({
      protocol,
      chainId,
      contractAddress,
      orderId: decimal(args.tradeId, 'Standard trade ID'),
      sequence: sequence.toString(),
      contractRevision: nextRevision,
      maker: address(args.maker, 'Standard trade maker'),
      participant: address(args.filler, 'Standard trade filler'),
      side: 'fill',
      source: 'public-event',
      amounts: {
        offerAmount: decimal(args.offerAmountOut, 'Standard offer amount'),
        requestAmount: decimal(args.requestAmountIn, 'Standard request amount')
      },
      postState: {
        remainingOfferAmount: decimal(args.remainingOfferAmount, 'Standard remaining offer'),
        remainingRequestAmount: decimal(args.remainingRequestAmount, 'Standard remaining request')
      },
      log: normalized.log
    });
  }

  if (description.name === 'PrivateOrderFilled') {
    return execution({
      protocol,
      chainId,
      contractAddress,
      orderId: decimal(args.orderId, 'Private order ID'),
      sequence: decimal(args.fillCount, 'Private fill count', UINT64_MAX),
      contractRevision: decimal(args.nextRevision, 'Private fill revision', UINT64_MAX),
      maker: address(args.maker, 'Private order maker'),
      participant: address(args.filler, 'Private order filler'),
      side: 'fill',
      source: 'private-marker',
      amounts: {},
      log: normalized.log
    });
  }

  if (description.name === 'RecurringOrderExecuted') {
    return execution({
      protocol,
      chainId,
      contractAddress,
      orderId: decimal(args.orderId, 'Recurring order ID'),
      sequence: decimal(args.executionIndex, 'Recurring execution index', UINT64_MAX),
      contractRevision: decimal(args.nextRevision, 'Recurring execution revision', UINT64_MAX),
      maker: address(args.maker, 'Recurring order maker'),
      participant: address(args.filler, 'Recurring order filler'),
      side: side(args.side, 'Recurring order side'),
      source: 'public-event',
      amounts: {
        baseAmount: decimal(args.baseAmount, 'Recurring base amount'),
        quoteAmount: decimal(args.quoteAmount, 'Recurring quote amount')
      },
      postState: {
        baseInventory: decimal(args.baseInventory, 'Recurring base inventory'),
        quoteInventory: decimal(args.quoteInventory, 'Recurring quote inventory')
      },
      log: normalized.log
    });
  }

  if (description.name === 'PrivateRecurringOrderExecuted') {
    return execution({
      protocol,
      chainId,
      contractAddress,
      orderId: decimal(args.orderId, 'Private recurring order ID'),
      sequence: decimal(args.executionIndex, 'Private recurring execution index', UINT64_MAX),
      contractRevision: decimal(args.nextRevision, 'Private recurring execution revision', UINT64_MAX),
      maker: address(args.maker, 'Private recurring order maker'),
      participant: address(args.filler, 'Private recurring order filler'),
      side: side(args.side, 'Private recurring order side'),
      source: 'private-marker',
      amounts: {},
      log: normalized.log
    });
  }

  if (description.name === 'PrivateOrderAccountSnapshotUpdated') {
    return Object.freeze({
      kind: 'encrypted-receipt',
      protocol: 'private-v2',
      chainId: decimal(chainId, 'Private receipt chain ID'),
      contractAddress: address(contractAddress, 'Private receipt contract'),
      orderId: decimal(args.orderId, 'Private receipt order ID'),
      recipient: address(args.recipient, 'Private receipt recipient'),
      participant: address(args.actor, 'Private receipt participant'),
      side: 'fill',
      contractRevision: decimal(args.sequence, 'Private receipt revision', UINT64_MAX),
      encryptedAmounts: Object.freeze({
        offerAmount: encryptedUint256(args.lastOfferAmount, 'Encrypted private offer amount'),
        requestAmount: encryptedUint256(args.lastRequestAmount, 'Encrypted private request amount')
      }),
      log: normalized.log
    });
  }

  if (description.name === 'PrivateRecurringExecutionReceiptUpdated') {
    return Object.freeze({
      kind: 'encrypted-receipt',
      protocol: 'private-recurring-v2',
      chainId: decimal(chainId, 'Private recurring receipt chain ID'),
      contractAddress: address(contractAddress, 'Private recurring receipt contract'),
      orderId: decimal(args.orderId, 'Private recurring receipt order ID'),
      recipient: address(args.recipient, 'Private recurring receipt recipient'),
      participant: address(args.filler, 'Private recurring receipt filler'),
      side: side(args.side, 'Private recurring receipt side'),
      executionSequence: decimal(args.executionIndex, 'Private recurring receipt execution index', UINT64_MAX),
      encryptedAmounts: Object.freeze({
        baseAmount: encryptedUint256(args.baseAmount, 'Encrypted private recurring base amount'),
        quoteAmount: encryptedUint256(args.quoteAmount, 'Encrypted private recurring quote amount')
      }),
      log: normalized.log
    });
  }

  if (
    description.name === 'StandardTradeOpened' ||
    description.name === 'PrivateOrderOpened' ||
    description.name === 'RecurringOrderOpened' ||
    description.name === 'PrivateRecurringOrderOpened'
  ) {
    const standard = description.name === 'StandardTradeOpened';
    const privateOrder = description.name === 'PrivateOrderOpened';
    const recurring = description.name === 'RecurringOrderOpened';
    const protocol = standard
      ? 'standard-v2'
      : privateOrder
        ? 'private-v2'
        : recurring
          ? 'recurring-v2'
          : 'private-recurring-v2';
    return Object.freeze({
      kind: 'lifecycle',
      lifecycleKind: 'opened',
      protocol,
      chainId: decimal(chainId, 'Order opening chain ID'),
      contractAddress: address(contractAddress, 'Order opening contract'),
      orderId: decimal(standard ? args.tradeId : args.orderId, 'Opened order ID'),
      maker: address(args.maker, 'Opened order maker'),
      createdAt: decimal(args.createdAt, 'Order creation time', UINT64_MAX),
      expiresAt: decimal(args.expiresAt, 'Order expiry', UINT64_MAX),
      contractRevision: decimal(args.revision, 'Order opening revision', UINT64_MAX),
      ...(privateOrder && isPrivateBookV2RuntimeHash(runtimeBytecodeHash ?? '') ? {
        publicPriceTerms: Object.freeze({
          offerAmount: decimal((args.priceTerms as ParsedArgs).offerAmount, 'Public price offer units', (1n << 128n) - 1n),
          requestAmount: decimal((args.priceTerms as ParsedArgs).requestAmount, 'Public price request units', (1n << 128n) - 1n)
        })
      } : {}),
      rootOrderId: standard || privateOrder
        ? decimal(standard ? args.rootTradeId : args.rootOrderId, 'Order root ID')
        : undefined,
      log: normalized.log
    });
  }

  if (description.name === 'RecurringOrderEdited') {
    return Object.freeze({
      kind: 'lifecycle',
      lifecycleKind: 'edited',
      protocol: 'recurring-v2',
      chainId: decimal(chainId, 'Recurring edit chain ID'),
      contractAddress: address(contractAddress, 'Recurring edit contract'),
      orderId: decimal(args.orderId, 'Recurring edit order ID'),
      maker: address(args.maker, 'Recurring edit maker'),
      expiresAt: decimal(args.expiresAt, 'Recurring edit expiry', UINT64_MAX),
      contractRevision: decimal(args.nextRevision, 'Recurring edit revision', UINT64_MAX),
      editAmounts: Object.freeze({
        baseAdded: decimal(args.baseAdded, 'Recurring base added'),
        quoteAdded: decimal(args.quoteAdded, 'Recurring quote added'),
        baseRemoved: decimal(args.baseRemoved, 'Recurring base removed'),
        quoteRemoved: decimal(args.quoteRemoved, 'Recurring quote removed')
      }),
      log: normalized.log
    });
  }

  if (description.name === 'PrivateRecurringOrderEdited') {
    return Object.freeze({
      kind: 'lifecycle',
      lifecycleKind: 'edited',
      protocol: 'private-recurring-v2',
      chainId: decimal(chainId, 'Private recurring edit chain ID'),
      contractAddress: address(contractAddress, 'Private recurring edit contract'),
      orderId: decimal(args.orderId, 'Private recurring edit order ID'),
      maker: address(args.maker, 'Private recurring edit maker'),
      expiresAt: decimal(args.expiresAt, 'Private recurring edit expiry', UINT64_MAX),
      contractRevision: decimal(args.nextRevision, 'Private recurring edit revision', UINT64_MAX),
      liquidityChanged: boolean(args.liquidityChanged, 'Private recurring liquidity change'),
      log: normalized.log
    });
  }

  if (
    description.name === 'StandardTradeReplaced' ||
    description.name === 'PrivateOrderReplaced' ||
    description.name === 'DirectTradeReplaced'
  ) {
    const standard = description.name === 'StandardTradeReplaced';
    const privateOrder = description.name === 'PrivateOrderReplaced';
    return Object.freeze({
      kind: 'lifecycle',
      lifecycleKind: 'replacement',
      protocol: standard ? 'standard-v2' : privateOrder ? 'private-v2' : 'direct-v2',
      chainId: decimal(chainId, 'Order replacement chain ID'),
      contractAddress: address(contractAddress, 'Order replacement contract'),
      orderId: decimal(
        standard ? args.originalTradeId : privateOrder ? args.originalOrderId : args.originalTradeId,
        'Original order ID'
      ),
      replacementOrderId: decimal(
        standard ? args.replacementTradeId : privateOrder ? args.replacementOrderId : args.replacementTradeId,
        'Replacement order ID'
      ),
      rootOrderId: decimal(
        standard ? args.rootTradeId : privateOrder ? args.rootOrderId : args.rootTradeId,
        'Replacement root ID'
      ),
      log: normalized.log
    });
  }

  if (description.name === 'StandardTradeStatusChanged') {
    return Object.freeze({
      kind: 'lifecycle',
      lifecycleKind: 'status',
      protocol: 'standard-v2',
      chainId: decimal(chainId, 'Standard status chain ID'),
      contractAddress: address(contractAddress, 'Standard status contract'),
      orderId: decimal(args.tradeId, 'Standard status trade ID'),
      maker: address(args.maker, 'Standard status maker'),
      previousStatus: decimal(args.previousStatus, 'Standard previous status', 5n),
      nextStatus: decimal(args.nextStatus, 'Standard next status', 5n),
      actor: address(args.actor, 'Standard status actor'),
      relatedOrderId: decimal(args.relatedTradeId, 'Standard related trade ID'),
      contractRevision: decimal(args.revision, 'Standard status revision', UINT64_MAX),
      log: normalized.log
    });
  }

  if (description.name === 'PrivateOrderStatusChanged') {
    return Object.freeze({
      kind: 'lifecycle',
      lifecycleKind: 'status',
      protocol: 'private-v2',
      chainId: decimal(chainId, 'Private status chain ID'),
      contractAddress: address(contractAddress, 'Private status contract'),
      orderId: decimal(args.orderId, 'Private status order ID'),
      maker: address(args.maker, 'Private status maker'),
      previousStatus: decimal(args.previousStatus, 'Private previous status', 5n),
      nextStatus: decimal(args.nextStatus, 'Private next status', 5n),
      actor: address(args.actor, 'Private status actor'),
      relatedOrderId: decimal(args.relatedOrderId, 'Private related order ID'),
      contractRevision: decimal(args.revision, 'Private status revision', UINT64_MAX),
      log: normalized.log
    });
  }

  if (
    description.name === 'RecurringOrderStatusChanged' ||
    description.name === 'PrivateRecurringOrderStatusChanged'
  ) {
    const privateRecurring = description.name === 'PrivateRecurringOrderStatusChanged';
    return Object.freeze({
      kind: 'lifecycle',
      lifecycleKind: 'status',
      protocol: privateRecurring ? 'private-recurring-v2' : 'recurring-v2',
      chainId: decimal(chainId, 'Recurring status chain ID'),
      contractAddress: address(contractAddress, 'Recurring status contract'),
      orderId: decimal(args.orderId, 'Recurring status order ID'),
      maker: address(args.maker, 'Recurring status maker'),
      previousStatus: decimal(args.previousStatus, 'Recurring previous status', 4n),
      nextStatus: decimal(args.nextStatus, 'Recurring next status', 4n),
      actor: address(args.actor, 'Recurring status actor'),
      contractRevision: decimal(args.nextRevision, 'Recurring status revision', UINT64_MAX),
      log: normalized.log
    });
  }

  if (description.name === 'RecurringInventorySettled') {
    return Object.freeze({
      kind: 'lifecycle',
      lifecycleKind: 'settlement',
      protocol: 'recurring-v2',
      chainId: decimal(chainId, 'Recurring settlement chain ID'),
      contractAddress: address(contractAddress, 'Recurring settlement contract'),
      orderId: decimal(args.orderId, 'Recurring settlement order ID'),
      maker: address(args.maker, 'Recurring settlement maker'),
      settledAmounts: Object.freeze({
        baseAmount: decimal(args.baseAmount, 'Recurring settled base amount'),
        quoteAmount: decimal(args.quoteAmount, 'Recurring settled quote amount')
      }),
      log: normalized.log
    });
  }

  if (description.name === 'PrivateRecurringInventorySettled') {
    return Object.freeze({
      kind: 'lifecycle',
      lifecycleKind: 'settlement',
      protocol: 'private-recurring-v2',
      chainId: decimal(chainId, 'Private recurring settlement chain ID'),
      contractAddress: address(contractAddress, 'Private recurring settlement contract'),
      orderId: decimal(args.orderId, 'Private recurring settlement order ID'),
      maker: address(args.maker, 'Private recurring settlement maker'),
      log: normalized.log
    });
  }

  if (description.name === 'DirectTradeOpened') {
    const amountMode = decimal(args.amountMode, 'Direct trade amount mode', 1n) === '0'
      ? 'public'
      : 'private';
    return Object.freeze({
      kind: 'direct-opened',
      protocol: 'direct-v2',
      chainId: decimal(chainId, 'Direct trade chain ID'),
      contractAddress: address(contractAddress, 'Direct trade contract'),
      orderId: decimal(args.tradeId, 'Direct trade ID'),
      maker: address(args.maker, 'Direct trade maker'),
      taker: address(args.taker, 'Direct trade taker'),
      parentEscrow: address(args.parentEscrow, 'Direct trade parent escrow'),
      parentTradeId: decimal(args.parentTradeId, 'Direct trade parent ID'),
      rootTradeId: decimal(args.rootTradeId, 'Direct trade root ID'),
      counterDepth: decimal(args.counterDepth, 'Direct trade counter depth', 255n),
      offerAssetType: assetType(args.offerAssetType, 'Direct offer asset type'),
      offerToken: address(args.offerToken, 'Direct offer token'),
      requestAssetType: assetType(args.requestAssetType, 'Direct request asset type'),
      requestToken: address(args.requestToken, 'Direct request token'),
      amountMode,
      publicAmounts: Object.freeze(amountMode === 'public'
        ? {
            offerAmount: decimal(args.publicOfferAmount, 'Direct public offer amount'),
            requestAmount: decimal(args.publicRequestAmount, 'Direct public request amount')
          }
        : {}),
      createdAt: decimal(args.createdAt, 'Direct trade creation time', UINT64_MAX),
      expiresAt: decimal(args.expiresAt, 'Direct trade expiry', UINT64_MAX),
      log: normalized.log
    });
  }

  if (description.name === 'DirectTradeStatusChanged') {
    return Object.freeze({
      kind: 'direct-status',
      protocol: 'direct-v2',
      chainId: decimal(chainId, 'Direct status chain ID'),
      contractAddress: address(contractAddress, 'Direct status contract'),
      orderId: decimal(args.tradeId, 'Direct status trade ID'),
      maker: address(args.maker, 'Direct status maker'),
      taker: address(args.taker, 'Direct status taker'),
      previousStatus: decimal(args.previousStatus, 'Direct previous status', 7n),
      nextStatus: decimal(args.nextStatus, 'Direct next status', 7n),
      actor: address(args.actor, 'Direct status actor'),
      relatedOrderId: decimal(args.relatedTradeId, 'Direct related trade ID'),
      changedAt: decimal(args.changedAt, 'Direct status time', UINT64_MAX),
      log: normalized.log
    });
  }

  return undefined;
};

export const materializeDirectTradeV2Acceptance = ({
  opened,
  status,
  recipient,
  decryptedAmounts
}: {
  opened: ParsedDirectTradeV2Opened;
  status: ParsedDirectTradeV2Status;
  recipient?: string;
  decryptedAmounts?: TradeHistoryV2Amounts;
}): TradeHistoryV2Observation => {
  if (
    opened.chainId !== status.chainId ||
    opened.contractAddress !== status.contractAddress ||
    opened.orderId !== status.orderId ||
    opened.maker !== status.maker ||
    opened.taker !== status.taker
  ) {
    throw new Error('Direct trade acceptance does not match its exact opened trade.');
  }
  if (
    status.previousStatus !== '1' ||
    status.nextStatus !== '2' ||
    status.actor !== opened.taker ||
    status.relatedOrderId !== opened.orderId
  ) {
    throw new Error('Direct trade status is not a canonical acceptance.');
  }
  if (opened.amountMode === 'public' && (recipient !== undefined || decryptedAmounts !== undefined)) {
    throw new Error('Public direct acceptance cannot carry a private receipt.');
  }
  if (opened.amountMode === 'private' && (recipient === undefined) !== (decryptedAmounts === undefined)) {
    throw new Error('Private direct acceptance requires both recipient and decrypted amounts, or neither.');
  }
  const source = opened.amountMode === 'public'
    ? 'public-event'
    : decryptedAmounts
      ? 'participant-receipt'
      : 'private-marker';
  const normalizedRecipient = recipient ? address(recipient, 'Direct receipt recipient') : undefined;
  if (
    normalizedRecipient &&
    normalizedRecipient !== opened.maker &&
    normalizedRecipient !== opened.taker
  ) {
    throw new Error('Direct private receipt recipient is not a trade participant.');
  }
  return normalizeTradeHistoryV2Observation({
    schema: 1,
    protocol: 'direct-v2',
    order: {
      chainId: opened.chainId,
      contractAddress: opened.contractAddress,
      orderId: opened.orderId
    },
    sequence: '1',
    maker: opened.maker,
    participant: opened.taker,
    side: 'accept',
    source,
    recipient: normalizedRecipient,
    amounts: opened.amountMode === 'public' ? opened.publicAmounts : decryptedAmounts ?? {},
    log: status.log
  });
};

const sameScopeAndExecution = (
  receipt: ParsedTradeHistoryV2PrivateReceipt,
  marker: ParsedTradeHistoryV2Execution
): boolean => {
  const observation = marker.observation;
  return (
    receipt.protocol === observation.protocol &&
    receipt.chainId === observation.order.chainId &&
    receipt.contractAddress === observation.order.contractAddress &&
    receipt.orderId === observation.order.orderId &&
    receipt.participant === observation.participant &&
    receipt.side === observation.side &&
    receipt.log.transactionHash === observation.log.transactionHash &&
    receipt.log.blockHash === observation.log.blockHash &&
    receipt.log.blockNumber === observation.log.blockNumber
  );
};

export const materializeTradeHistoryV2ParticipantReceipt = ({
  receipt,
  marker,
  decryptedAmounts
}: {
  receipt: ParsedTradeHistoryV2PrivateReceipt;
  marker: ParsedTradeHistoryV2Execution;
  decryptedAmounts: TradeHistoryV2Amounts;
}): TradeHistoryV2Observation => {
  if (!sameScopeAndExecution(receipt, marker)) {
    throw new Error('Private trade receipt does not belong to the exact execution marker.');
  }
  if (receipt.protocol === 'private-v2') {
    if (receipt.contractRevision !== marker.contractRevision) {
      throw new Error('Private trade receipt revision does not match its execution marker.');
    }
  } else if (receipt.executionSequence !== marker.observation.sequence) {
    throw new Error('Private recurring receipt sequence does not match its execution marker.');
  }
  return normalizeTradeHistoryV2Observation({
    ...marker.observation,
    source: 'participant-receipt',
    recipient: receipt.recipient,
    amounts: decryptedAmounts,
    postState: undefined,
    log: receipt.log
  });
};

export const TRADE_HISTORY_V2_EVENT_ABIS = Object.freeze({
  standard: STANDARD_ABI,
  private: PRIVATE_ABI,
  recurring: RECURRING_ABI,
  privateRecurring: PRIVATE_RECURRING_ABI,
  direct: DIRECT_ABI
});
