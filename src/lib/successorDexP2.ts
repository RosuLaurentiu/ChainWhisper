import { AbiCoder, Contract, Interface, getAddress, type JsonRpcSigner } from '@coti-io/coti-ethers';
import { decryptUint } from '@coti-io/coti-sdk-typescript';
import { ensureTradeTokenAllowance } from './appChain';
import { encryptAuthenticatedUint64Input } from './authenticatedUint64';
import {
  formatDexV2LotsAsTokenAmount,
  parseDexV2TokenAmountToLots,
  scaleDexV2LotsToRaw
} from './dexV2Terms';
import type { SuccessorDexManifest, SuccessorDexPair } from './successorDexDeployment';
import type { SuccessorSwapPlan } from './successorDexSwap';

const Q = 100_000_000n;
const PPM = 1_000_000n;
const MAX_RATE_PPM = 10_000_000n;
const FUNDING_REVISION = 1n;
const P2_CLASS = 2;
const GAS_LIMIT = 90_000_000n;

const ABI = Object.freeze([
  'event PrivateIntentP2Submitted(uint256 indexed intentId,address indexed owner,address indexed recipient,address tokenIn,address tokenOut,uint64 expiry)',
  'event PrivateIntentP2Processed(uint256 indexed intentId,uint8 indexed status,uint64 attemptCount)',
  'event PrivateIntentP2Recovered(uint256 indexed intentId,uint8 indexed status)',
  'event PrivateIntentP2CreditWithdrawn(address indexed owner,address indexed token,uint64 creditRevision)',
  'event CompleteBookP2WorkOpened(uint256 indexed intentId,uint64 indexed workRevision,uint256 reservedWorkWei)',
  'event CompleteBookP2WorkFrameProcessed(uint256 indexed intentId,uint64 indexed workRevision,uint8 stage)',
  'event CompleteBookP2WorkRecovered(uint256 indexed intentId,address indexed owner,uint256 recoveredWorkWei)',
  'function submitAndOpenPrivateIntentP2(address recipient,address tokenIn,address tokenOut,uint64 expectedRouteRegistryRevision,uint64 expectedFundingRevision,uint64 expectedOwnerNonce,uint8 expectedClass,uint64 expiry,(uint256 ciphertext,bytes signature) maximumInput,(uint256 ciphertext,bytes signature) minimumOutput,(uint256 ciphertext,bytes signature) minimumRatePpm) payable returns(uint256 intentId)',
  'function quoteCompleteBookP2Work(address tokenIn,address tokenOut,uint64 expectedRouteRegistryRevision) returns(uint256 requiredEscrowWei)',
  'function reopenCompleteBookP2Work(uint256 intentId,uint64 expectedIntentRevision,uint64 expectedRouteRegistryRevision) payable',
  'function advanceCompleteBookP2Work(uint256 intentId,uint64 expectedWorkRevision)',
  'function settleCompleteBookP2Work(uint256 intentId,uint64 expectedWorkRevision,uint64 expectedIntentRevision,uint64 expectedRouteRegistryRevision,uint64 expectedFundingRevision,uint8 expectedClass)',
  'function foldCompleteBookP2Work(uint256 intentId,uint64 expectedWorkRevision)',
  'function recoverExpiredCompleteBookP2Work(uint256 intentId,uint64 expectedWorkRevision)',
  'function cancelPrivateIntentP2(uint256 intentId,uint64 expectedIntentRevision,uint64 expectedOwnerNonce)',
  'function recoverExpiredPrivateIntentP2(uint256 intentId,uint64 expectedIntentRevision)',
  'function withdrawPrivateIntentP2Credit(address token,uint64 expectedCreditRevision,uint64 expectedOwnerNonce,(uint256 ciphertext,bytes signature) amountLots)',
  'function reencryptMyPrivateIntentP2Receipt(uint256 intentId) returns(bytes)',
  'function privateBookWorkCredit(address owner) returns(uint256)',
  'function withdrawPrivateBookWorkCredit() returns(uint256 amount)'
] as const);

const CORE_ABI = Object.freeze([
  'function directCreditRevision(address owner,address token) view returns(uint64)',
  'function reencryptMyDirectCredit(address token) returns((uint256 ciphertext,uint256 userCiphertext))'
] as const);

const ROUTES_ABI = Object.freeze([
  'function registryRevision() view returns(uint64)'
] as const);

const EVENTS = new Interface(ABI);
const RECEIPT = AbiCoder.defaultAbiCoder();
type ParsedP2Event = NonNullable<ReturnType<typeof EVENTS.parseLog>>;

type P2Event = Readonly<{
  name: 'submitted' | 'processed' | 'recovered' | 'work-opened' | 'work-frame' | 'work-recovered';
  status?: number;
  revision?: bigint;
  stage?: number;
  attemptCount?: bigint;
}>;

export type SuccessorP2Plan = Readonly<{
  pair: SuccessorDexPair;
  eligibility: 'sparse' | 'direct-no-match';
  inputSymbol: string;
  outputSymbol: string;
  inputToken: string;
  outputToken: string;
  inputDecimals: number;
  outputDecimals: number;
  inputLotSizeRaw: bigint;
  outputLotSizeRaw: bigint;
  maximumInputLots: bigint;
  maximumInputRaw: bigint;
  minimumOutputLots: bigint;
  minimumRatePpm: bigint;
}>;

export type SuccessorP2Status = Readonly<{
  intentId: bigint;
  owner: string;
  recipient: string;
  tokenIn: string;
  tokenOut: string;
  expiry: bigint;
  routeRegistryRevision: bigint;
  fundingRevision: bigint;
  intentRevision: bigint;
  intentStatus: 1 | 2 | 3 | 4;
  attemptCount: bigint;
  workRevision: bigint;
  workStage: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
  workRecovered: boolean;
  workCredit: bigint;
  latestTimestamp: bigint;
}>;

export type SuccessorP2Receipt = Readonly<{
  inputUsed: bigint;
  grossOutput: bigint;
  refund: bigint;
  netOutput: bigint;
  fee: bigint;
  selectedRouteIndexPlusOne: bigint;
  invalid: boolean;
  intentRevision: bigint;
}>;

export const formatSuccessorP2PlanAmount = (
  plan: SuccessorP2Plan,
  lots: bigint,
  output = false
): string => formatDexV2LotsAsTokenAmount(
  lots,
  output ? plan.outputDecimals : plan.inputDecimals,
  output ? plan.outputLotSizeRaw : plan.inputLotSizeRaw
);

export type SuccessorP2Action =
  | 'reopen'
  | 'advance'
  | 'settle'
  | 'fold'
  | 'recover-work'
  | 'recover-intent'
  | 'complete';

const token = (manifest: SuccessorDexManifest, symbol: string) => {
  const found = manifest.tokens.find((item) => item.symbol === symbol);
  if (!found) throw new Error(`${symbol} is not in the successor token manifest.`);
  return found;
};

const tokenAt = (manifest: SuccessorDexManifest, address: string) => {
  const found = manifest.tokens.find((item) => item.address.toLowerCase() === address.toLowerCase());
  if (!found) throw new Error('The P2 token is not in the successor token manifest.');
  return found;
};

const ceilDiv = (numerator: bigint, denominator: bigint): bigint =>
  (numerator + denominator - 1n) / denominator;

const userCiphertext = (value: unknown): bigint => {
  if (Array.isArray(value)) return BigInt(value[1]);
  if (value && typeof value === 'object' && 'userCiphertext' in value) {
    return BigInt((value as { userCiphertext: bigint }).userCiphertext);
  }
  throw new Error('The private receipt ciphertext is invalid.');
};

const authorityAddress = (manifest: SuccessorDexManifest): string => {
  const address = manifest.contracts['work-authority']?.address;
  if (!address) throw new Error('The corrected successor work authority is missing.');
  return address;
};

const routeRegistryAddress = (manifest: SuccessorDexManifest): string => {
  const address = manifest.contracts['p2-route-registry']?.address;
  if (!address) throw new Error('The corrected P2 route registry is missing.');
  return address;
};

export const planSuccessorP2Intent = ({
  manifest,
  selectedPair,
  direction,
  amount,
  displayedLimitPrice,
  minimumPercent
}: {
  manifest: SuccessorDexManifest;
  selectedPair: readonly [string, string];
  direction: 'base-to-quote' | 'quote-to-base';
  amount: string;
  displayedLimitPrice: number;
  minimumPercent: number;
}): SuccessorP2Plan => {
  const pair = manifest.pairs.find((item) => item.displayPair === selectedPair.join('/'));
  if (!pair) throw new Error('The selected pair is not in the successor manifest.');
  const eligibility = pair.sourceCount === 0 ? 'sparse' : null;
  if (!eligibility) throw new Error('P2 is available only for a sparse pair or after an authenticated exhausted-direct receipt.');
  if (!Number.isFinite(displayedLimitPrice) || displayedLimitPrice <= 0) {
    throw new Error('Price protection is invalid.');
  }
  if (![0, 25, 50, 100].includes(minimumPercent)) throw new Error('Minimum fill is invalid.');

  const inputSymbol = direction === 'base-to-quote' ? selectedPair[0] : selectedPair[1];
  const outputSymbol = direction === 'base-to-quote' ? selectedPair[1] : selectedPair[0];
  const input = token(manifest, inputSymbol);
  const output = token(manifest, outputSymbol);
  const maximumInputLots = parseDexV2TokenAmountToLots(
    amount,
    input.decimals,
    BigInt(input.lotSizeRaw)
  );
  const maximumProfile = BigInt(manifest.privateBookWorkProfile.maximumInputLots);
  if (maximumInputLots > maximumProfile) {
    throw new Error(`This corrected work profile accepts at most ${formatDexV2LotsAsTokenAmount(
      maximumProfile,
      input.decimals,
      BigInt(input.lotSizeRaw)
    )} ${inputSymbol}.`);
  }

  const displayedBase = token(manifest, selectedPair[0]).address;
  const canonicalHumanPrice = displayedBase.toLowerCase() === pair.token0.toLowerCase()
    ? displayedLimitPrice
    : 1 / displayedLimitPrice;
  const token0 = manifest.tokens.find(({ address }) => address.toLowerCase() === pair.token0.toLowerCase());
  const token1 = manifest.tokens.find(({ address }) => address.toLowerCase() === pair.token1.toLowerCase());
  if (!token0 || !token1) throw new Error('The canonical pair tokens are missing.');
  const token0Lot = Number(formatDexV2LotsAsTokenAmount(1n, token0.decimals, BigInt(token0.lotSizeRaw)));
  const token1Lot = Number(formatDexV2LotsAsTokenAmount(1n, token1.decimals, BigInt(token1.lotSizeRaw)));
  const priceQ = BigInt(Math.round(canonicalHumanPrice * token0Lot / token1Lot * Number(Q)));
  if (priceQ <= 0n) throw new Error('Price protection is invalid.');
  const outputIsToken0 = output.address.toLowerCase() === pair.token0.toLowerCase();
  const indicativeOutput = outputIsToken0
    ? maximumInputLots * Q / priceQ
    : maximumInputLots * priceQ / Q;
  const minimumOutputLots = minimumPercent === 0
    ? 0n
    : ceilDiv(indicativeOutput * BigInt(minimumPercent), 100n);
  const minimumRatePpm = outputIsToken0
    ? ceilDiv(Q * PPM, priceQ)
    : ceilDiv(priceQ * PPM, Q);
  if (minimumOutputLots > 1_048_575n || minimumRatePpm > MAX_RATE_PPM) {
    throw new Error('P2 protection exceeds the corrected private-intent bounds.');
  }
  return Object.freeze({
    pair,
    eligibility,
    inputSymbol,
    outputSymbol,
    inputToken: input.address,
    outputToken: output.address,
    inputDecimals: input.decimals,
    outputDecimals: output.decimals,
    inputLotSizeRaw: BigInt(input.lotSizeRaw),
    outputLotSizeRaw: BigInt(output.lotSizeRaw),
    maximumInputLots,
    maximumInputRaw: scaleDexV2LotsToRaw(maximumInputLots, BigInt(input.lotSizeRaw)),
    minimumOutputLots,
    minimumRatePpm
  });
};

export const planSuccessorP2FallbackFromDirect = ({
  directPlan,
  directUnavailable
}: {
  directPlan: SuccessorSwapPlan;
  directUnavailable: boolean;
}): SuccessorP2Plan => {
  if (!directUnavailable || directPlan.pair.sourceCount === 0) {
    throw new Error('P2 fallback requires an authenticated exhausted-direct owner receipt.');
  }
  const minimumRatePpm = directPlan.buyToken0
    ? ceilDiv(Q * PPM, directPlan.limitPriceQ)
    : ceilDiv(directPlan.limitPriceQ * PPM, Q);
  if (directPlan.minimumOutputLots > 1_048_575n || minimumRatePpm > MAX_RATE_PPM) {
    throw new Error('P2 protection exceeds the corrected private-intent bounds.');
  }
  return Object.freeze({
    pair: directPlan.pair,
    eligibility: 'direct-no-match',
    inputSymbol: directPlan.inputSymbol,
    outputSymbol: directPlan.outputSymbol,
    inputToken: directPlan.inputToken,
    outputToken: directPlan.outputToken,
    inputDecimals: directPlan.inputDecimals,
    outputDecimals: directPlan.outputDecimals,
    inputLotSizeRaw: directPlan.inputLotSizeRaw,
    outputLotSizeRaw: directPlan.outputLotSizeRaw,
    maximumInputLots: directPlan.maximumInputLots,
    maximumInputRaw: directPlan.maximumInputRaw,
    minimumOutputLots: directPlan.minimumOutputLots,
    minimumRatePpm
  });
};

export const reduceSuccessorP2Events = (
  events: readonly P2Event[]
): Pick<SuccessorP2Status, 'intentRevision' | 'intentStatus' | 'attemptCount' | 'workRevision' | 'workStage' | 'workRecovered'> => {
  let intentStatus: 1 | 2 | 3 | 4 = 1;
  let attemptCount = 0n;
  let workRevision = 0n;
  let workStage: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 = 0;
  let workRecovered = false;
  for (const event of events) {
    if (event.name === 'processed') {
      intentStatus = (event.status ?? 1) as 1 | 2;
      attemptCount = event.attemptCount ?? attemptCount;
    } else if (event.name === 'recovered') {
      intentStatus = (event.status ?? 3) as 3 | 4;
    } else if (event.name === 'work-opened') {
      workRevision = event.revision ?? 1n;
      workStage = 1;
      workRecovered = false;
    } else if (event.name === 'work-frame') {
      workRevision = event.revision ?? workRevision;
      workStage = (event.stage ?? workStage) as SuccessorP2Status['workStage'];
    } else if (event.name === 'work-recovered') {
      workRecovered = true;
      workRevision += 1n;
      workStage = 6;
    }
  }
  return Object.freeze({
    intentRevision: intentStatus === 1 ? 1n : 2n,
    intentStatus,
    attemptCount,
    workRevision,
    workStage,
    workRecovered
  });
};

export const nextSuccessorP2Action = (status: SuccessorP2Status): SuccessorP2Action => {
  if (status.workStage === 5 || status.workStage === 6) return 'fold';
  if (status.workStage >= 1 && status.workStage <= 4 &&
      (status.intentStatus !== 1 || status.latestTimestamp >= status.expiry)) {
    return 'recover-work';
  }
  if (status.intentStatus !== 1) return 'complete';
  const expired = status.latestTimestamp >= status.expiry;
  if (status.workStage === 0 || status.workStage === 7) {
    return expired ? 'recover-intent' : 'reopen';
  }
  if (status.workStage === 4) return 'settle';
  if (status.workStage >= 1 && status.workStage <= 3) return 'advance';
  return 'complete';
};

const logsForIntent = async (
  signer: JsonRpcSigner,
  manifest: SuccessorDexManifest,
  eventName: string,
  intentId: bigint
) => signer.provider.getLogs({
  address: manifest.globalCore,
  fromBlock: manifest.deploymentBlockRange[0],
  toBlock: 'latest',
  topics: EVENTS.encodeFilterTopics(EVENTS.getEvent(eventName)!, [intentId])
});

export const readSuccessorP2OwnerNonce = async (
  signer: JsonRpcSigner,
  manifest: SuccessorDexManifest,
  ownerInput?: string
): Promise<bigint> => {
  const owner = getAddress(ownerInput ?? await signer.getAddress());
  const submittedEvent = EVENTS.getEvent('PrivateIntentP2Submitted')!;
  const withdrawnEvent = EVENTS.getEvent('PrivateIntentP2CreditWithdrawn')!;
  const recoveredEvent = EVENTS.getEvent('PrivateIntentP2Recovered')!;
  const [submitted, withdrawn, cancelled] = await Promise.all([
    signer.provider.getLogs({
      address: manifest.globalCore,
      fromBlock: manifest.deploymentBlockRange[0],
      toBlock: 'latest',
      topics: EVENTS.encodeFilterTopics(submittedEvent, [null, owner, null])
    }),
    signer.provider.getLogs({
      address: manifest.globalCore,
      fromBlock: manifest.deploymentBlockRange[0],
      toBlock: 'latest',
      topics: EVENTS.encodeFilterTopics(withdrawnEvent, [owner, null, null])
    }),
    signer.provider.getLogs({
      address: manifest.globalCore,
      fromBlock: manifest.deploymentBlockRange[0],
      toBlock: 'latest',
      topics: EVENTS.encodeFilterTopics(recoveredEvent, [null, 4])
    })
  ]);
  const ownedIds = new Set(submitted.map((log) => String(EVENTS.parseLog(log)?.args[0])));
  const cancelledOwned = cancelled.filter((log) => ownedIds.has(String(EVENTS.parseLog(log)?.args[0]))).length;
  return BigInt(submitted.length + withdrawn.length + cancelledOwned);
};

export const submitSuccessorP2Intent = async ({
  signer,
  manifest,
  plan,
  lifetimeSeconds = 3_600n
}: {
  signer: JsonRpcSigner;
  manifest: SuccessorDexManifest;
  plan: SuccessorP2Plan;
  lifetimeSeconds?: bigint;
}): Promise<Readonly<{ intentId: bigint; expiry: bigint; transactionHash: string; status: SuccessorP2Status }>> => {
  if (lifetimeSeconds <= 0n) throw new Error('The P2 lifetime must be positive.');
  const owner = getAddress(await signer.getAddress());
  const target = authorityAddress(manifest);
  const authority = new Contract(target, ABI, signer);
  const routeRegistry = new Contract(routeRegistryAddress(manifest), ROUTES_ABI, signer);
  const [routeRevision, nonce, latest] = await Promise.all([
    routeRegistry.getFunction('registryRevision').staticCall(),
    readSuccessorP2OwnerNonce(signer, manifest, owner),
    signer.provider.getBlock('latest')
  ]);
  if (!latest) throw new Error('The latest COTI block is unavailable.');
  const expectedRouteRegistryRevision = BigInt(routeRevision);
  const requiredWorkEscrowWei = BigInt(await authority
    .getFunction('quoteCompleteBookP2Work')
    .staticCall(plan.inputToken, plan.outputToken, expectedRouteRegistryRevision));
  if (plan.eligibility === 'sparse') {
    await ensureTradeTokenAllowance(
      signer,
      owner,
      plan.inputToken,
      plan.maximumInputRaw,
      'private-erc20',
      manifest.globalCore
    );
  }
  const selector = authority.interface.getFunction('submitAndOpenPrivateIntentP2')!.selector;
  const encrypt = (plaintext: bigint) => encryptAuthenticatedUint64Input(signer, {
    plaintext,
    contractAddress: target,
    functionSelector: selector
  });
  const [maximumInput, minimumOutput, minimumRate] = await Promise.all([
    encrypt(plan.maximumInputLots),
    encrypt(plan.minimumOutputLots),
    encrypt(plan.minimumRatePpm)
  ]);
  const expiry = BigInt(latest.timestamp) + lifetimeSeconds;
  const transaction = await authority.submitAndOpenPrivateIntentP2(
    owner,
    plan.inputToken,
    plan.outputToken,
    expectedRouteRegistryRevision,
    FUNDING_REVISION,
    nonce,
    P2_CLASS,
    expiry,
    maximumInput,
    minimumOutput,
    minimumRate,
    { value: requiredWorkEscrowWei, gasLimit: GAS_LIMIT }
  );
  const receipt = await transaction.wait(1);
  if (!receipt || receipt.status !== 1) throw new Error('P2 intent submission failed.');
  const receiptEvents: ParsedP2Event[] = receipt.logs.flatMap((log: { address: string; topics: readonly string[]; data: string }) => {
    if (log.address.toLowerCase() !== manifest.globalCore.toLowerCase()) return [];
    try {
      const parsed = EVENTS.parseLog({ topics: [...log.topics], data: log.data });
      return parsed ? [parsed] : [];
    } catch {
      return [];
    }
  });
  const submitted = receiptEvents.find((event) => event.name === 'PrivateIntentP2Submitted');
  const opened = receiptEvents.find((event) => event.name === 'CompleteBookP2WorkOpened');
  if (!submitted || !opened) throw new Error('P2 submission receipt is missing its atomic lifecycle events.');
  const intentId = BigInt(submitted.args[0]);
  return Object.freeze({
    intentId,
    expiry,
    transactionHash: receipt.hash,
    status: Object.freeze({
      intentId,
      owner,
      recipient: getAddress(submitted.args[2]),
      tokenIn: plan.inputToken,
      tokenOut: plan.outputToken,
      expiry,
      routeRegistryRevision: expectedRouteRegistryRevision,
      fundingRevision: FUNDING_REVISION,
      intentRevision: 1n,
      intentStatus: 1,
      attemptCount: 0n,
      workRevision: BigInt(opened.args[1]),
      workStage: 1,
      workRecovered: false,
      workCredit: 0n,
      latestTimestamp: BigInt(latest.timestamp)
    })
  });
};

export const readSuccessorP2Status = async ({
  signer,
  manifest,
  intentId
}: {
  signer: JsonRpcSigner;
  manifest: SuccessorDexManifest;
  intentId: bigint;
}): Promise<SuccessorP2Status> => {
  const [submittedLogs, processedLogs, recoveredLogs, openedLogs, frameLogs, workRecoveredLogs, latest] = await Promise.all([
    logsForIntent(signer, manifest, 'PrivateIntentP2Submitted', intentId),
    logsForIntent(signer, manifest, 'PrivateIntentP2Processed', intentId),
    logsForIntent(signer, manifest, 'PrivateIntentP2Recovered', intentId),
    logsForIntent(signer, manifest, 'CompleteBookP2WorkOpened', intentId),
    logsForIntent(signer, manifest, 'CompleteBookP2WorkFrameProcessed', intentId),
    logsForIntent(signer, manifest, 'CompleteBookP2WorkRecovered', intentId),
    signer.provider.getBlock('latest')
  ]);
  const submitted = submittedLogs[0] && EVENTS.parseLog(submittedLogs[0]);
  if (!submitted || submitted.name !== 'PrivateIntentP2Submitted') {
    throw new Error(`P2 intent #${intentId} was not submitted by the corrected authority.`);
  }
  const transaction = await signer.provider.getTransaction(submittedLogs[0].transactionHash);
  const parsedCall = transaction && EVENTS.parseTransaction({ data: transaction.data, value: transaction.value });
  if (transaction?.to?.toLowerCase() !== authorityAddress(manifest).toLowerCase() ||
      !parsedCall || parsedCall.name !== 'submitAndOpenPrivateIntentP2' || !latest) {
    throw new Error('The P2 submission domain cannot be reconstructed.');
  }
  type OrderedEvent = P2Event & Readonly<{ blockNumber: number; logIndex: number }>;
  const decode = (
    log: { topics: readonly string[]; data: string; blockNumber?: number; index?: number; logIndex?: number },
    name: P2Event['name']
  ): OrderedEvent | null => {
    const parsed = EVENTS.parseLog({ topics: [...log.topics], data: log.data });
    if (!parsed) return null;
    const order = { blockNumber: Number(log.blockNumber ?? 0), logIndex: Number(log.index ?? log.logIndex ?? 0) };
    if (name === 'processed') return { name, status: Number(parsed.args[1]), attemptCount: BigInt(parsed.args[2]), ...order };
    if (name === 'recovered') return { name, status: Number(parsed.args[1]), ...order };
    if (name === 'work-opened') return { name, revision: BigInt(parsed.args[1]), ...order };
    if (name === 'work-frame') return { name, revision: BigInt(parsed.args[1]), stage: Number(parsed.args[2]), ...order };
    return { name, ...order };
  };
  const ordered = [
    ...processedLogs.map((log) => decode(log, 'processed')),
    ...recoveredLogs.map((log) => decode(log, 'recovered')),
    ...openedLogs.map((log) => decode(log, 'work-opened')),
    ...frameLogs.map((log) => decode(log, 'work-frame')),
    ...workRecoveredLogs.map((log) => decode(log, 'work-recovered'))
  ].filter((event): event is OrderedEvent => event !== null).sort((left, right) =>
    left.blockNumber - right.blockNumber || left.logIndex - right.logIndex
  );
  const reduced = reduceSuccessorP2Events([
    { name: 'submitted' },
    ...ordered
  ]);
  const owner = getAddress(submitted.args[1]);
  const authority = new Contract(authorityAddress(manifest), ABI, signer);
  const workCredit = BigInt(await authority.getFunction('privateBookWorkCredit').staticCall(owner));
  return Object.freeze({
    intentId,
    owner,
    recipient: getAddress(submitted.args[2]),
    tokenIn: getAddress(submitted.args[3]),
    tokenOut: getAddress(submitted.args[4]),
    expiry: BigInt(submitted.args[5]),
    routeRegistryRevision: BigInt(parsedCall.args[3]),
    fundingRevision: BigInt(parsedCall.args[4]),
    ...reduced,
    workCredit,
    latestTimestamp: BigInt(latest.timestamp)
  });
};

export const successorP2PairMatches = (
  pair: SuccessorDexPair,
  tokenIn: string,
  tokenOut: string
): boolean => {
  const endpoints = new Set([tokenIn.toLowerCase(), tokenOut.toLowerCase()]);
  return endpoints.size === 2 && endpoints.has(pair.token0.toLowerCase()) && endpoints.has(pair.token1.toLowerCase());
};

export type ResumableSuccessorP2 = Readonly<{
  intentId: bigint;
  expiry: bigint;
  plan: SuccessorP2Plan;
  status: SuccessorP2Status;
  maximumKnown: false;
  settled: boolean;
  recovered: boolean;
}>;

export const findResumableSuccessorP2 = async ({ signer, manifest, pair }: {
  signer: JsonRpcSigner;
  manifest: SuccessorDexManifest;
  pair: SuccessorDexPair;
}): Promise<ResumableSuccessorP2 | null> => {
  const owner = getAddress(await signer.getAddress());
  const event = EVENTS.getEvent('PrivateIntentP2Submitted')!;
  const logs = await signer.provider.getLogs({
    address: manifest.globalCore,
    fromBlock: manifest.deploymentBlockRange[0],
    toBlock: 'latest',
    topics: EVENTS.encodeFilterTopics(event, [null, owner, null])
  });
  for (const log of [...logs].reverse()) {
    const transaction = await signer.provider.getTransaction(log.transactionHash);
    if (!transaction || transaction.to?.toLowerCase() !== authorityAddress(manifest).toLowerCase()) continue;
    const call = EVENTS.parseTransaction({ data: transaction.data, value: transaction.value });
    if (!call || call.name !== 'submitAndOpenPrivateIntentP2') continue;
    const tokenIn = getAddress(call.args[1]);
    const tokenOut = getAddress(call.args[2]);
    if (!successorP2PairMatches(pair, tokenIn, tokenOut)) continue;
    const parsed = EVENTS.parseLog({ topics: [...log.topics], data: log.data });
    if (!parsed || parsed.name !== 'PrivateIntentP2Submitted') continue;
    const intentId = BigInt(parsed.args[0]);
    const status = await readSuccessorP2Status({ signer, manifest, intentId });
    if (status.intentStatus !== 1 && status.workCredit === 0n) {
      const aesKey = signer.getUserOnboardInfo()?.aesKey?.trim();
      if (aesKey) {
        const core = new Contract(manifest.globalCore, CORE_ABI, signer);
        const [inputCredit, outputCredit] = await Promise.all([
          core.getFunction('reencryptMyDirectCredit').staticCall(tokenIn),
          core.getFunction('reencryptMyDirectCredit').staticCall(tokenOut)
        ]);
        if (
          BigInt(decryptUint(userCiphertext(inputCredit), aesKey)) === 0n &&
          BigInt(decryptUint(userCiphertext(outputCredit), aesKey)) === 0n
        ) continue;
      }
    }
    const input = tokenAt(manifest, tokenIn);
    const output = tokenAt(manifest, tokenOut);
    return Object.freeze({
      intentId,
      expiry: status.expiry,
      status,
      maximumKnown: false,
      settled: status.intentStatus === 2,
      recovered: status.intentStatus === 3 || status.intentStatus === 4,
      plan: Object.freeze({
        pair,
        eligibility: pair.sourceCount === 0 ? 'sparse' : 'direct-no-match',
        inputSymbol: input.symbol,
        outputSymbol: output.symbol,
        inputToken: tokenIn,
        outputToken: tokenOut,
        inputDecimals: input.decimals,
        outputDecimals: output.decimals,
        inputLotSizeRaw: BigInt(input.lotSizeRaw),
        outputLotSizeRaw: BigInt(output.lotSizeRaw),
        maximumInputLots: 0n,
        maximumInputRaw: 0n,
        minimumOutputLots: 0n,
        minimumRatePpm: 0n
      })
    });
  }
  return null;
};

export const reopenSuccessorP2Work = async ({ signer, manifest, status }: {
  signer: JsonRpcSigner;
  manifest: SuccessorDexManifest;
  status: SuccessorP2Status;
}): Promise<Readonly<{ transactionHash: string; status: SuccessorP2Status }>> => {
  const owner = getAddress(await signer.getAddress());
  if (owner !== status.owner || nextSuccessorP2Action(status) !== 'reopen') {
    throw new Error('Only the owner can reopen this live pending P2 intent.');
  }
  const authority = new Contract(authorityAddress(manifest), ABI, signer);
  const requiredWorkEscrowWei = BigInt(await authority
    .getFunction('quoteCompleteBookP2Work')
    .staticCall(status.tokenIn, status.tokenOut, status.routeRegistryRevision));
  const receipt = await (await authority.reopenCompleteBookP2Work(
    status.intentId,
    status.intentRevision,
    status.routeRegistryRevision,
    { value: requiredWorkEscrowWei, gasLimit: GAS_LIMIT }
  )).wait(1);
  if (!receipt || receipt.status !== 1) throw new Error('P2 work reopening failed.');
  const opened = receipt.logs.flatMap((log: { address: string; topics: readonly string[]; data: string }) => {
    if (log.address.toLowerCase() !== manifest.globalCore.toLowerCase()) return [];
    try {
      const parsed = EVENTS.parseLog({ topics: [...log.topics], data: log.data });
      return parsed?.name === 'CompleteBookP2WorkOpened' ? [parsed] : [];
    } catch {
      return [];
    }
  })[0];
  if (!opened || BigInt(opened.args[0]) !== status.intentId) {
    throw new Error('P2 work reopening receipt is missing its canonical open event.');
  }
  return Object.freeze({
    transactionHash: receipt.hash,
    status: Object.freeze({
      ...status,
      workRevision: BigInt(opened.args[1]),
      workStage: 1,
      workRecovered: false
    })
  });
};

export const processSuccessorP2KeeperFrame = async ({
  signer,
  manifest,
  status
}: {
  signer: JsonRpcSigner;
  manifest: SuccessorDexManifest;
  status: SuccessorP2Status;
}): Promise<Readonly<{ action: 'advance' | 'settle' | 'fold'; transactionHash: string }>> => {
  const action = nextSuccessorP2Action(status);
  if (action !== 'advance' && action !== 'settle' && action !== 'fold') {
    throw new Error(`P2 ${action} is an owner or terminal action, not keeper work.`);
  }
  const authority = new Contract(authorityAddress(manifest), ABI, signer);
  const transaction = action === 'advance'
    ? await authority.advanceCompleteBookP2Work(status.intentId, status.workRevision, { gasLimit: GAS_LIMIT })
    : action === 'settle'
      ? await authority.settleCompleteBookP2Work(
          status.intentId,
          status.workRevision,
          status.intentRevision,
          status.routeRegistryRevision,
          status.fundingRevision,
          P2_CLASS,
          { gasLimit: GAS_LIMIT }
        )
      : await authority.foldCompleteBookP2Work(status.intentId, status.workRevision, { gasLimit: GAS_LIMIT });
  const receipt = await transaction.wait(1);
  if (!receipt || receipt.status !== 1) throw new Error(`P2 ${action} frame failed.`);
  return Object.freeze({ action, transactionHash: receipt.hash });
};

export const cancelSuccessorP2Intent = async ({ signer, manifest, status }: {
  signer: JsonRpcSigner;
  manifest: SuccessorDexManifest;
  status: SuccessorP2Status;
}): Promise<Readonly<{ transactionHash: string; status: SuccessorP2Status }>> => {
  const owner = getAddress(await signer.getAddress());
  if (owner !== status.owner || status.intentStatus !== 1 || status.latestTimestamp >= status.expiry) {
    throw new Error('Only the owner can cancel a live pending P2 intent.');
  }
  const nonce = await readSuccessorP2OwnerNonce(signer, manifest, owner);
  const authority = new Contract(authorityAddress(manifest), ABI, signer);
  const receipt = await (await authority.cancelPrivateIntentP2(
    status.intentId,
    status.intentRevision,
    nonce,
    { gasLimit: GAS_LIMIT }
  )).wait(1);
  if (!receipt || receipt.status !== 1) throw new Error('P2 cancellation failed.');
  return Object.freeze({
    transactionHash: receipt.hash,
    status: Object.freeze({
      ...status,
      intentRevision: status.intentRevision + 1n,
      intentStatus: 4
    })
  });
};

export const recoverExpiredSuccessorP2 = async ({ signer, manifest, status }: {
  signer: JsonRpcSigner;
  manifest: SuccessorDexManifest;
  status: SuccessorP2Status;
}): Promise<Readonly<{
  action: 'recover-work' | 'recover-intent';
  transactionHash: string;
  status: SuccessorP2Status;
}>> => {
  const action = nextSuccessorP2Action(status);
  if (action !== 'recover-work' && action !== 'recover-intent') {
    throw new Error('This P2 lifecycle is not recoverable.');
  }
  const authority = new Contract(authorityAddress(manifest), ABI, signer);
  const transaction = action === 'recover-work'
    ? await authority.recoverExpiredCompleteBookP2Work(status.intentId, status.workRevision, { gasLimit: GAS_LIMIT })
    : await authority.recoverExpiredPrivateIntentP2(status.intentId, status.intentRevision, { gasLimit: GAS_LIMIT });
  const receipt = await transaction.wait(1);
  if (!receipt || receipt.status !== 1) throw new Error(`P2 ${action} failed.`);
  const nextStatus: SuccessorP2Status = action === 'recover-work'
    ? Object.freeze({ ...status, workRevision: status.workRevision + 1n, workStage: 6, workRecovered: true })
    : Object.freeze({
        ...status,
        intentRevision: status.intentRevision + 1n,
        intentStatus: 3,
        workRecovered: status.workRecovered
      });
  return Object.freeze({ action, transactionHash: receipt.hash, status: nextStatus });
};

export const revealSuccessorP2Receipt = async ({ signer, manifest, intentId }: {
  signer: JsonRpcSigner;
  manifest: SuccessorDexManifest;
  intentId: bigint;
}): Promise<SuccessorP2Receipt> => {
  const aesKey = signer.getUserOnboardInfo()?.aesKey?.trim();
  if (!aesKey) throw new Error('Unlock privacy before revealing the P2 receipt.');
  const authority = new Contract(authorityAddress(manifest), ABI, signer);
  const encoded = await authority.getFunction('reencryptMyPrivateIntentP2Receipt').staticCall(intentId);
  const [receipt] = RECEIPT.decode([
    'tuple(tuple(uint256 ciphertext,uint256 userCiphertext) inputUsed,tuple(uint256 ciphertext,uint256 userCiphertext) grossOutput,tuple(uint256 ciphertext,uint256 userCiphertext) refund,tuple(uint256 ciphertext,uint256 userCiphertext) netOutput,tuple(uint256 ciphertext,uint256 userCiphertext) fee,tuple(uint256 ciphertext,uint256 userCiphertext) selectedRouteIndexPlusOne,tuple(uint256 ciphertext,uint256 userCiphertext) invalid,uint64 intentRevision)'
  ], encoded);
  const reveal = (value: unknown) => BigInt(decryptUint(userCiphertext(value), aesKey));
  return Object.freeze({
    inputUsed: reveal(receipt.inputUsed ?? receipt[0]),
    grossOutput: reveal(receipt.grossOutput ?? receipt[1]),
    refund: reveal(receipt.refund ?? receipt[2]),
    netOutput: reveal(receipt.netOutput ?? receipt[3]),
    fee: reveal(receipt.fee ?? receipt[4]),
    selectedRouteIndexPlusOne: reveal(receipt.selectedRouteIndexPlusOne ?? receipt[5]),
    invalid: reveal(receipt.invalid ?? receipt[6]) !== 0n,
    intentRevision: BigInt(receipt.intentRevision ?? receipt[7])
  });
};

export const withdrawSuccessorP2Credit = async ({
  signer,
  manifest,
  tokenAddress,
  amountLots
}: {
  signer: JsonRpcSigner;
  manifest: SuccessorDexManifest;
  tokenAddress: string;
  amountLots?: bigint;
}): Promise<Readonly<{ amountLots: bigint; remainingLots: bigint; transactionHash: string }>> => {
  if (amountLots !== undefined && (amountLots <= 0n || amountLots > 1_048_575n)) {
    throw new Error('The P2 credit amount is invalid.');
  }
  const owner = getAddress(await signer.getAddress());
  const aesKey = signer.getUserOnboardInfo()?.aesKey?.trim();
  if (!aesKey) throw new Error('Unlock privacy before withdrawing the P2 credit.');
  const authority = new Contract(authorityAddress(manifest), ABI, signer);
  const core = new Contract(manifest.globalCore, CORE_ABI, signer);
  const [creditRevision, nonce, encryptedCredit] = await Promise.all([
    core.getFunction('directCreditRevision').staticCall(owner, tokenAddress),
    readSuccessorP2OwnerNonce(signer, manifest, owner),
    core.getFunction('reencryptMyDirectCredit').staticCall(tokenAddress)
  ]);
  const available = BigInt(decryptUint(userCiphertext(encryptedCredit), aesKey));
  const amount = amountLots === undefined
    ? available > 1_048_575n ? 1_048_575n : available
    : amountLots > available ? available : amountLots;
  if (amount === 0n) return Object.freeze({ amountLots: 0n, remainingLots: 0n, transactionHash: '' });
  const selector = authority.interface.getFunction('withdrawPrivateIntentP2Credit')!.selector;
  const encrypted = await encryptAuthenticatedUint64Input(signer, {
    plaintext: amount,
    contractAddress: authorityAddress(manifest),
    functionSelector: selector
  });
  const receipt = await (await authority.withdrawPrivateIntentP2Credit(
    tokenAddress,
    BigInt(creditRevision),
    nonce,
    encrypted,
    { gasLimit: GAS_LIMIT }
  )).wait(1);
  if (!receipt || receipt.status !== 1) throw new Error('P2 credit withdrawal failed.');
  return Object.freeze({ amountLots: amount, remainingLots: available - amount, transactionHash: receipt.hash });
};

export const withdrawSuccessorP2WorkCredit = async ({ signer, manifest }: {
  signer: JsonRpcSigner;
  manifest: SuccessorDexManifest;
}): Promise<Readonly<{ amount: bigint; transactionHash: string }>> => {
  const owner = getAddress(await signer.getAddress());
  const authority = new Contract(authorityAddress(manifest), ABI, signer);
  const amount = BigInt(await authority.getFunction('privateBookWorkCredit').staticCall(owner));
  if (amount === 0n) throw new Error('No P2 work credit is available.');
  const receipt = await (await authority.withdrawPrivateBookWorkCredit({ gasLimit: GAS_LIMIT })).wait(1);
  if (!receipt || receipt.status !== 1) throw new Error('P2 work-credit withdrawal failed.');
  return Object.freeze({ amount, transactionHash: receipt.hash });
};
