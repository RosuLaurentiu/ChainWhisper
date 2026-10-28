import { Interface, getAddress } from '@coti-io/coti-ethers';
import { currentCheapDexStages, type CurrentCheapDexIdentity } from './dexV2Deployment';

// Public read codec only. Not a deployment attestation or permission to accept.
export const CURRENT_DEX_OPERATION_ABI = [
  'function operationPublic(uint256 operationId) view returns ((bool quotePrepared,bool funded,bytes32 contextHash,uint8 status,uint8 releaseReason,uint256 epochId,uint256 deadline,uint256 fixedCursor,uint256 stageRevision) result)'
] as const;
const iface = new Interface(CURRENT_DEX_OPERATION_ABI);
export const CURRENT_SHARED_POOL_OPERATION_ABI = [
  'function operationPublic(uint256 operationId) view returns ((bool quotePrepared,bool funded,bytes32 contextHash,uint8 status,uint8 releaseReason,uint256 epochId,uint256 deadline,uint256 fixedCursor,uint256 stageRevision,uint256 canonicalMarketId,uint256 marketRevision,uint256 registryRevision) result)'
] as const;
const sharedPoolInterface = new Interface(CURRENT_SHARED_POOL_OPERATION_ABI);
const amount = '((uint256 ciphertextHigh,uint256 ciphertextLow) ciphertext,(uint256 ciphertextHigh,uint256 ciphertextLow) userCiphertext)';
export const CURRENT_DEX_RECEIPT_ABI = [
  `function principalReceipt(uint256 operationId) view returns (( (uint256 ciphertext,uint256 userCiphertext) filled,${amount} maximumInput,${amount} actualInput,${amount} refund,${amount} grossOutput,${amount} fee,${amount} netOutput))`
] as const;
const receiptInterface = new Interface(CURRENT_DEX_RECEIPT_ABI);
export const CURRENT_DEX_OPEN_ABI = [
  'function openSinglePassSwapV2(address inputToken,address outputToken,address destination,uint256 deadline,((uint256 ciphertextHigh,uint256 ciphertextLow) ciphertext,bytes signature) encryptedMaximumInput,((uint256 ciphertextHigh,uint256 ciphertextLow) ciphertext,bytes signature) encryptedMinimumInput,((uint256 ciphertextHigh,uint256 ciphertextLow) ciphertext,bytes signature) encryptedMinimumOutput,(uint256 ciphertext,bytes signature) encryptedMinimumRateNumerator,(uint256 ciphertext,bytes signature) encryptedMinimumRateDenominator) returns (uint256)',
  'event WorkIssued(uint256 indexed operationId,uint256 indexed epochId,bytes32 indexed releaseId,uint256 deadline)'
] as const;
const openInterface = new Interface(CURRENT_DEX_OPEN_ABI);
export type CurrentCheapDexProfile = 'fast-pool' | 'cheap-async';
export const CURRENT_CHEAP_DEX_QUOTE_ABI = [
  CURRENT_DEX_OPEN_ABI[0].replace('openSinglePassSwapV2', 'quoteFastPoolV1'),
  'function quoteCheapAsyncV1((address inputToken,address outputToken,address destination,uint256 deadline,((uint256 ciphertextHigh,uint256 ciphertextLow) ciphertext,bytes signature) maximumInput,((uint256 ciphertextHigh,uint256 ciphertextLow) ciphertext,bytes signature) minimumInput,((uint256 ciphertextHigh,uint256 ciphertextLow) ciphertext,bytes signature) minimumOutput,(uint256 ciphertext,bytes signature) minimumRateNumerator,(uint256 ciphertext,bytes signature) minimumRateDenominator) request) returns (uint256 quoteId)',
  'event FastPoolQuoteIssued(uint256 indexed quoteId,bytes32 indexed context,uint256 deadline)',
  'event CheapAsyncAdvanced(uint256 indexed quoteId,uint8 stage,bytes32 context)'
] as const;
const cheapQuoteInterface = new Interface(CURRENT_CHEAP_DEX_QUOTE_ABI);
// Unsigned codec for the new candidate only. Existing wallet admission still
// accepts the frozen current ABI, not these selectors.
export const CURRENT_SLIPPAGE_DEX_QUOTE_ABI = [
  CURRENT_CHEAP_DEX_QUOTE_ABI[0].replace('quoteFastPoolV1', 'quoteFastPool')
    .replace(') returns (uint256)', ',uint16 toleranceBps) returns (uint256)'),
  CURRENT_CHEAP_DEX_QUOTE_ABI[1].replace('quoteCheapAsyncV1', 'quoteCheapAsync')
    .replace(' minimumRateDenominator) request', ' minimumRateDenominator,uint16 toleranceBps) request'),
  ...CURRENT_CHEAP_DEX_QUOTE_ABI.slice(2)
] as const;
const slippageQuoteInterface = new Interface(CURRENT_SLIPPAGE_DEX_QUOTE_ABI);
type EncryptedQuoteAmount = Readonly<{ ciphertext: Readonly<{ ciphertextHigh: bigint; ciphertextLow: bigint }>; signature: string }>;
type EncryptedQuoteRate = Readonly<{ ciphertext: bigint; signature: string }>;
// Encoding only. Ciphertext authentication and deployment/signing admission are
// separate checks; an encoded call is not permission to submit it.
export const encodeCurrentDexQuoteRequest = (request: Readonly<{
  profile: CurrentCheapDexProfile; quoteProtocol?: 'quote-slippage'; toleranceBps?: number;
  inputToken: string; outputToken: string; destination: string; deadline: bigint;
  maximumInput: EncryptedQuoteAmount; minimumInput: EncryptedQuoteAmount; minimumOutput: EncryptedQuoteAmount;
  minimumRateNumerator: EncryptedQuoteRate; minimumRateDenominator: EncryptedQuoteRate;
}>): string => {
  if (request.profile !== 'fast-pool' && request.profile !== 'cheap-async') throw new Error('Unknown current quote profile.');
  if (request.quoteProtocol !== undefined && request.quoteProtocol !== 'quote-slippage') throw new Error('Unknown quote protocol.');
  const slippage = request.quoteProtocol === 'quote-slippage';
  if (slippage ? !Number.isInteger(request.toleranceBps) || request.toleranceBps! < 0 || request.toleranceBps! > 10000
    : request.toleranceBps !== undefined) throw new Error('Quote tolerance is not bound to its protocol.');
  const tokens = [request.inputToken, request.outputToken, request.destination].map(getAddress);
  if (tokens.some(token => BigInt(token) === 0n) || tokens[0] === tokens[1]) throw new Error('Invalid quote addresses.');
  uint(request.deadline);
  if (!request.deadline) throw new Error('Invalid quote deadline.');
  for (const value of [request.maximumInput, request.minimumInput, request.minimumOutput]) {
    uint(value.ciphertext.ciphertextHigh); uint(value.ciphertext.ciphertextLow);
  }
  for (const value of [request.minimumRateNumerator, request.minimumRateDenominator]) uint(value.ciphertext);
  for (const value of [request.maximumInput, request.minimumInput, request.minimumOutput,
    request.minimumRateNumerator, request.minimumRateDenominator]) {
    if (!/^0x[0-9a-fA-F]{130}$/.test(value.signature)) throw new Error('Invalid private input signature shape.');
  }
  const method = request.profile === 'fast-pool' ? slippage ? 'quoteFastPool' : 'quoteFastPoolV1'
    : slippage ? 'quoteCheapAsync' : 'quoteCheapAsyncV1';
  const terms = [...tokens, request.deadline, request.maximumInput, request.minimumInput, request.minimumOutput,
    request.minimumRateNumerator, request.minimumRateDenominator, ...(slippage ? [request.toleranceBps] : [])];
  return (slippage ? slippageQuoteInterface : cheapQuoteInterface)
    .encodeFunctionData(method, request.profile === 'cheap-async' ? [terms] : terms);
};
export const CURRENT_CHEAP_DEX_OPERATION_ABI = [
  'function fastPoolQuotePublic(uint256 quoteId) view returns (bytes32 context,uint256 deadline,bool ready)',
  'function cheapAsyncPublic(uint256 quoteId) view returns (uint8 stage,bytes32 context,uint256 deadline)'
] as const;
const cheapOperationInterface = new Interface(CURRENT_CHEAP_DEX_OPERATION_ABI);
export const CURRENT_FAST_DEX_RECEIPT_ABI = [CURRENT_DEX_RECEIPT_ABI[0].replace('principalReceipt', 'fastPoolPrincipalReceipt')] as const;
const fastReceiptInterface = new Interface(CURRENT_FAST_DEX_RECEIPT_ABI);

export const encodeCurrentCheapDexOperationRead = (operationId: bigint, profile: CurrentCheapDexProfile) => {
  if (profile !== 'fast-pool' && profile !== 'cheap-async') throw new Error('Unknown current quote profile.');
  encodeCurrentDexOperationRead(operationId);
  return cheapOperationInterface.encodeFunctionData(profile === 'fast-pool' ? 'fastPoolQuotePublic' : 'cheapAsyncPublic', [operationId]);
};

export const decodeCurrentCheapDexOperation = (data: string, timestamp: bigint, profile: CurrentCheapDexProfile, candidate?: CurrentCheapDexIdentity) => {
  uint(timestamp);
  if (profile !== 'fast-pool' && profile !== 'cheap-async') throw new Error('Unknown current quote profile.');
  const method = profile === 'fast-pool' ? 'fastPoolQuotePublic' : 'cheapAsyncPublic';
  const result = cheapOperationInterface.decodeFunctionResult(method, data);
  if (cheapOperationInterface.encodeFunctionResult(method, result).toLowerCase() !== data.toLowerCase()) {
    throw new Error('Invalid current quote state encoding.');
  }
  const contextHash = String(result.context), deadline = BigInt(result.deadline);
  const stage = profile === 'cheap-async' ? Number(result.stage) : undefined;
  const missing = stage === 0 || (profile === 'fast-pool' && BigInt(contextHash) === 0n && deadline === 0n && !result.ready);
  const stages = currentCheapDexStages(candidate);
  const ready = profile === 'fast-pool' ? Boolean(result.ready) : stage === stages.ready;
  if ((missing && (BigInt(contextHash) !== 0n || deadline !== 0n)) || (!missing && deadline === 0n) ||
      (profile === 'fast-pool' && !missing && BigInt(contextHash) === 0n) ||
      (stage !== undefined && (stage > stages.released || (stage >= 1 && stage < stages.ready && BigInt(contextHash) !== 0n) ||
        (stage >= stages.ready && stage <= stages.settled && BigInt(contextHash) === 0n)))) {
    throw new Error('Inconsistent current quote state.');
  }
  // Fast ready=false proves only that acceptance is unavailable. Its getter omits consumed.
  const phase = missing ? 'not-found' : profile === 'fast-pool' && !ready ? 'consumed-unverified' :
    stage === stages.settled ? 'settled' : stage === stages.released ? 'released' : timestamp >= deadline ? 'expired-unrecovered' :
    stage === stages.funded ? 'settling' : ready ? 'quote-prepared' : 'preparing-quote';
  return Object.freeze({ profile, phase, contextHash, deadline, ready, stage });
};

// Decode only after independent receipt retrieval. Canonical-chain/finality and
// deployment checks remain the reader's job; WorkIssued does not contain context.
export const decodeCurrentDexQuoteIssue = ({ transaction, receipt, expected, profile = 'legacy', quoteProtocol }: {
  profile?: 'legacy' | CurrentCheapDexProfile;
  quoteProtocol?: 'quote-slippage';
  transaction: Readonly<{ hash: string; chainId: bigint; from: string; to: string | null;
    data: string; value: bigint; blockNumber: number | null; blockHash: string | null }>;
  receipt: Readonly<{ hash: string; from: string; to: string | null; status: number | null;
    blockNumber: number; blockHash: string;
    logs: ReadonlyArray<Readonly<{ address: string; topics: ReadonlyArray<string>; data: string }>> }>;
  expected: Readonly<{ transactionHash: string; chainId: bigint; core: string; principal: string;
    calldata: string; inputToken: string; outputToken: string; destination: string; deadline: bigint; releaseId: string;
    toleranceBps?: number }>;
}) => {
  const hash = (value: string | null) => {
    if (!value || !/^0x[0-9a-fA-F]{64}$/.test(value) || BigInt(value) === 0n) throw new Error('Invalid quote issue hash.');
    return value.toLowerCase();
  };
  const address = (value: string | null) => {
    if (!value) throw new Error('Invalid quote issue address.');
    const result = getAddress(value);
    if (BigInt(result) === 0n) throw new Error('Invalid quote issue address.');
    return result;
  };
  const core = address(expected.core), principal = address(expected.principal);
  const inputToken = address(expected.inputToken), outputToken = address(expected.outputToken);
  if (inputToken === outputToken) throw new Error('Invalid quote issue token pair.');
  const transactionHash = hash(expected.transactionHash), blockHash = hash(receipt.blockHash);
  if (uint(expected.chainId) === 0n || transaction.chainId !== expected.chainId ||
      hash(transaction.hash) !== transactionHash || hash(receipt.hash) !== transactionHash ||
      address(transaction.to) !== core || address(receipt.to) !== core ||
      address(transaction.from) !== principal || address(receipt.from) !== principal ||
      transaction.value !== 0n || receipt.status !== 1 ||
      !Number.isSafeInteger(receipt.blockNumber) || receipt.blockNumber < 0 ||
      transaction.blockNumber !== receipt.blockNumber || hash(transaction.blockHash) !== blockHash ||
      !/^0x(?:[0-9a-fA-F]{2})+$/.test(expected.calldata) || transaction.data.toLowerCase() !== expected.calldata.toLowerCase()) {
    throw new Error('Quote issue does not match the submitted transaction.');
  }
  if (!['legacy', 'fast-pool', 'cheap-async'].includes(profile)) throw new Error('Unknown current quote profile.');
  if (quoteProtocol !== undefined && quoteProtocol !== 'quote-slippage') throw new Error('Unknown quote protocol.');
  const slippage = quoteProtocol === 'quote-slippage';
  if (slippage ? profile === 'legacy' || !Number.isInteger(expected.toleranceBps) ||
      expected.toleranceBps! < 0 || expected.toleranceBps! > 10000 : expected.toleranceBps !== undefined) {
    throw new Error('Quote tolerance is not bound to its protocol.');
  }
  const opening = profile === 'legacy' ? openInterface : slippage ? slippageQuoteInterface : cheapQuoteInterface;
  const method = profile === 'legacy' ? 'openSinglePassSwapV2' : profile === 'fast-pool'
    ? slippage ? 'quoteFastPool' : 'quoteFastPoolV1' : slippage ? 'quoteCheapAsync' : 'quoteCheapAsyncV1';
  const decoded = opening.decodeFunctionData(method, expected.calldata);
  const args = profile === 'cheap-async' ? decoded.request : decoded;
  if (address(args.inputToken) !== inputToken || address(args.outputToken) !== outputToken ||
      address(args.destination) !== address(expected.destination) || address(args.destination) === core ||
      uint(expected.deadline) === 0n || args.deadline !== expected.deadline ||
      (slippage && args.toleranceBps !== BigInt(expected.toleranceBps!)) ||
      opening.encodeFunctionData(method, decoded).toLowerCase() !== expected.calldata.toLowerCase()) {
    throw new Error('Quote issue does not match the submitted terms.');
  }
  const event = opening.getEvent(profile === 'legacy' ? 'WorkIssued' : profile === 'fast-pool' ? 'FastPoolQuoteIssued' : 'CheapAsyncAdvanced')!;
  const logs = receipt.logs.filter(log => address(log.address) === core && log.topics[0]?.toLowerCase() === event.topicHash);
  if (logs.length !== 1) throw new Error('Expected one Core quote issue event.');
  const log = logs[0], issued = opening.decodeEventLog(event, log.data, [...log.topics]);
  const encoded = opening.encodeEventLog(event, issued);
  const operationId = profile === 'legacy' ? issued.operationId : issued.quoteId;
  if (log.topics.length !== encoded.topics.length || log.data.toLowerCase() !== encoded.data ||
      log.topics.some((topic, i) => topic.toLowerCase() !== encoded.topics[i]) ||
      uint(operationId) === 0n ||
      (profile === 'legacy' && (uint(issued.epochId) === 0n || hash(issued.releaseId) !== hash(expected.releaseId))) ||
      (profile === 'cheap-async' ? issued.stage !== 1n || BigInt(issued.context) !== 0n : issued.deadline !== expected.deadline) ||
      (profile === 'fast-pool' && BigInt(issued.context) === 0n)) {
    throw new Error('Invalid Core quote issue event.');
  }
  hash(expected.releaseId);
  return Object.freeze({ operationId: BigInt(operationId), ...(profile === 'legacy' ? { epochId: BigInt(issued.epochId) } :
    profile === 'fast-pool' ? { contextHash: hash(issued.context) } : {}),
    ...(slippage ? { quoteProtocol, toleranceBps: expected.toleranceBps } : {}),
    releaseId: hash(expected.releaseId), deadline: expected.deadline, transactionHash,
    block: Object.freeze({ number: BigInt(receipt.blockNumber), hash: blockHash }) });
};

export const encodeCurrentDexReceiptRead = (operationId: bigint, profile?: CurrentCheapDexProfile): string => {
  encodeCurrentDexOperationRead(operationId);
  return profile === 'fast-pool' ? fastReceiptInterface.encodeFunctionData('fastPoolPrincipalReceipt', [operationId]) :
    receiptInterface.encodeFunctionData('principalReceipt', [operationId]);
};

// Retain only recipient ciphertext. The public authenticated ciphertext is not a wallet amount.
export const decodeCurrentDexReceipt = (data: string, profile?: CurrentCheapDexProfile) => {
  const decoder = profile === 'fast-pool' ? fastReceiptInterface : receiptInterface;
  const method = profile === 'fast-pool' ? 'fastPoolPrincipalReceipt' : 'principalReceipt';
  const decoded = decoder.decodeFunctionResult(method, data);
  if (decoder.encodeFunctionResult(method, decoded).toLowerCase() !== data.toLowerCase()) throw new Error('Invalid current receipt encoding.');
  const receipt = decoded[0];
  const userAmount = (name: string) => Object.freeze({
    ciphertextHigh: BigInt(receipt[name].userCiphertext.ciphertextHigh),
    ciphertextLow: BigInt(receipt[name].userCiphertext.ciphertextLow)
  });
  return Object.freeze({ filled: BigInt(receipt.filled.userCiphertext),
    maximumInput: userAmount('maximumInput'), actualInput: userAmount('actualInput'),
    refund: userAmount('refund'), grossOutput: userAmount('grossOutput'),
    fee: userAmount('fee'), netOutput: userAmount('netOutput') });
};
const max = (1n << 256n) - 1n;
const uint = (value: bigint) => {
  if (typeof value !== 'bigint' || value < 0n || value > max) throw new Error('Invalid DEX integer.');
  return value;
};

export const encodeCurrentDexOperationRead = (operationId: bigint): string => {
  if (uint(operationId) === 0n) throw new Error('Invalid DEX operation ID.');
  return iface.encodeFunctionData('operationPublic', [operationId]);
};

export const decodeCurrentDexOperation = (data: string, blockTimestamp: bigint, profile: 'legacy' | 'shared-pool' = 'legacy') => {
  uint(blockTimestamp);
  const op = (profile === 'shared-pool' ? sharedPoolInterface : iface).decodeFunctionResult('operationPublic', data)[0];
  const status = Number(op.status), releaseReason = Number(op.releaseReason);
  if (status > 4 || releaseReason > 3 || (status !== 4 && releaseReason !== 0)) {
    throw new Error('Unknown or inconsistent DEX operation status.');
  }
  if ((op.funded && !op.quotePrepared) || (status === 1 && (op.funded || op.quotePrepared)) ||
      (status === 3 && !op.funded) || (status === 4 && releaseReason === 0)) {
    throw new Error('Inconsistent DEX operation flags.');
  }
  // Expiry is not recovery. SETTLED is not proof of a positive fill or wallet payout.
  const phase = status === 0 ? 'not-found' : status === 3 ? 'settled' : status === 4 ? 'released' :
    blockTimestamp >= op.deadline ? 'expired-unrecovered' : op.funded ? 'settling' :
    op.quotePrepared ? 'quote-prepared' : 'preparing-quote';
  const binding = profile === 'shared-pool' ? {
    canonicalMarketId: BigInt(op.canonicalMarketId), marketRevision: BigInt(op.marketRevision),
    registryRevision: BigInt(op.registryRevision)
  } : {};
  if (profile === 'shared-pool' && status !== 0 &&
      (binding.canonicalMarketId === 0n || binding.marketRevision === 0n || binding.registryRevision === 0n)) {
    throw new Error('Shared-Pool operation market binding is invalid.');
  }
  return Object.freeze({ phase, status, releaseReason, quotePrepared: Boolean(op.quotePrepared),
    funded: Boolean(op.funded), contextHash: String(op.contextHash), epochId: BigInt(op.epochId),
    deadline: BigInt(op.deadline), fixedCursor: BigInt(op.fixedCursor), stageRevision: BigInt(op.stageRevision), ...binding });
};
