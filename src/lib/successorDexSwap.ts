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

const Q = 100_000_000n;
const UINT64_MAX = (1n << 64n) - 1n;
const INITIAL_REQUEST_REVISION = 1n;
export const SUCCESSOR_DEX_GAS_LIMIT = 90_000_000n;

const ABI = Object.freeze([
  'event PrivateBookSubmitted(uint256 indexed requestId,address indexed owner,address indexed recipient,uint64 epochId,uint64 deadline)',
  'event PrivateBookProcessed(uint256 indexed requestId,uint8 indexed status,uint64 requestRevision)',
  'event PrivateBookRecovered(uint256 indexed requestId,uint8 indexed status,uint64 requestRevision)',
  'function submitPrivateBook(address recipient,bytes32 marketKey,bool buyToken0,uint64 expectedOwnerNonce,(uint256 ciphertext,bytes signature) maximumInput,(uint256 ciphertext,bytes signature) limitPriceQ,(uint256 ciphertext,bytes signature) minimumOutput) payable returns(uint256 requestId)',
  'function advancePrivateBookWork(uint256 requestId,uint64 expectedWorkRevision)',
  'function settlePrivateBook(uint256 requestId,uint64 expectedRequestRevision)',
  'function recoverPrivateBook(uint256 requestId,uint64 expectedRequestRevision)',
  'function privateBookWorkConfig(bytes32 marketKey) returns(uint256 fixedCredit,uint256 requiredEscrow,uint256 totalLiability,uint256 cleanupRequestId)',
  'function privateBookWorkState(uint256 requestId) returns(uint8 workCursor,uint8 cleanupCursor,bool recoveryCleanup,bool workClosed,uint64 workRevision,uint256 remainingEscrow)',
  'function privateBookWorkCredit(address owner) returns(uint256)',
  'function withdrawPrivateBookWorkCredit() returns(uint256 amount)',
  'function privateBookOwnerNonce(address owner) returns(uint64)',
  'function reencryptMyPrivateBookReceipt(uint256 requestId) returns(bytes)'
] as const);

const CORE_ABI = Object.freeze([
  'function directOwnerNonces(address owner) view returns(uint64)',
  'function directCreditRevision(address owner,address token) view returns(uint64)',
  'function reencryptMyDirectCredit(address token) returns((uint256 ciphertext,uint256 userCiphertext))',
  'function withdrawDirectCredit(address token,uint64 expectedCreditRevision,uint64 expectedOwnerNonce,(uint256 ciphertext,bytes signature) amountLots)'
] as const);

const EVENTS = new Interface(ABI);
const CORE = new Interface(CORE_ABI);
const RECEIPT = AbiCoder.defaultAbiCoder();

export type SuccessorSwapPlan = Readonly<{
  pair: SuccessorDexPair;
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
  limitPriceQ: bigint;
  minimumOutputLots: bigint;
  buyToken0: boolean;
}>;

export type SuccessorSwapProgress = Readonly<{
  workCursor: number;
  settlementCursor: number;
  cleanupCursor: number;
  sourceCount: number;
  recoveryCleanup: boolean;
  workRevision: bigint;
  workClosed: boolean;
  remainingEscrow: bigint;
  workCredit: bigint;
  latestBlock: bigint;
  terminalState: 'settled' | 'recovered' | null;
}>;

export type SuccessorSwapReceipt = Readonly<{
  inputUsed: bigint;
  netOutput: bigint;
  refund: bigint;
  fee: bigint;
  invalid: boolean;
  directUnavailable: boolean;
}>;

export type SuccessorSwapWorkAction =
  | 'advance'
  | 'settle'
  | 'recover'
  | 'cleanup'
  | 'withdraw-credit'
  | 'complete';

const token = (manifest: SuccessorDexManifest, symbol: string) => {
  const found = manifest.tokens.find((item) => item.symbol === symbol);
  if (!found) throw new Error(`${symbol} is not in the successor token manifest.`);
  return found;
};

const tokenSymbol = (manifest: SuccessorDexManifest, address: string): string => {
  const found = manifest.tokens.find((item) => item.address.toLowerCase() === address.toLowerCase());
  if (!found) throw new Error('The successor Swap token is not in the manifest.');
  return found.symbol;
};

export const successorSwapAmountProfile = (
  manifest: SuccessorDexManifest,
  symbol: string
): Readonly<{ lotAmount: string; maximumAmount: string; maximumInputLots: bigint }> => {
  const selected = token(manifest, symbol);
  const lotSizeRaw = BigInt(selected.lotSizeRaw);
  const maximumInputLots = BigInt(manifest.privateBookWorkProfile.maximumInputLots);
  return Object.freeze({
    lotAmount: formatDexV2LotsAsTokenAmount(1n, selected.decimals, lotSizeRaw),
    maximumAmount: formatDexV2LotsAsTokenAmount(maximumInputLots, selected.decimals, lotSizeRaw),
    maximumInputLots
  });
};

export const formatSuccessorSwapPlanAmount = (
  plan: SuccessorSwapPlan,
  lots: bigint,
  output = false
): string => formatDexV2LotsAsTokenAmount(
  lots,
  output ? plan.outputDecimals : plan.inputDecimals,
  output ? plan.outputLotSizeRaw : plan.inputLotSizeRaw
);

const submissionLogs = (signer: JsonRpcSigner, manifest: SuccessorDexManifest, owner: string) => {
  const event = EVENTS.getEvent('PrivateBookSubmitted')!;
  return signer.provider.getLogs({
    address: manifest.globalCore,
    fromBlock: manifest.deploymentBlockRange[0],
    toBlock: 'latest',
    topics: EVENTS.encodeFilterTopics(event, [null, getAddress(owner), null])
  });
};

export const planSuccessorSwap = ({
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
}): SuccessorSwapPlan => {
  const pair = manifest.pairs.find((item) => item.displayPair === selectedPair.join('/'));
  if (!pair) throw new Error('The selected pair is not in the successor manifest.');
  if (pair.sourceCount === 0) throw new Error('This pair is reserved for sparse-pair P2 testing. Direct Swap has no source to execute.');
  if (!Number.isFinite(displayedLimitPrice) || displayedLimitPrice <= 0) throw new Error('Price protection is invalid.');
  if (![0, 25, 50, 100].includes(minimumPercent)) throw new Error('Minimum fill is invalid.');

  const inputSymbol = direction === 'base-to-quote' ? selectedPair[0] : selectedPair[1];
  const outputSymbol = direction === 'base-to-quote' ? selectedPair[1] : selectedPair[0];
  const input = token(manifest, inputSymbol);
  const output = token(manifest, outputSymbol);
  const inputToken = input.address;
  const outputToken = output.address;
  const maximumProfile = successorSwapAmountProfile(manifest, inputSymbol);
  let maximumInputLots: bigint;
  try {
    maximumInputLots = parseDexV2TokenAmountToLots(amount, input.decimals, BigInt(input.lotSizeRaw));
  } catch (error) {
    if (error instanceof Error && /settlement-lot multiple/.test(error.message)) {
      throw new Error(`Enter a ${inputSymbol} amount in exact ${maximumProfile.lotAmount} settlement-lot increments.`);
    }
    throw error;
  }
  if (maximumInputLots > maximumProfile.maximumInputLots) {
    throw new Error(`This private-book profile accepts at most ${maximumProfile.maximumAmount} ${inputSymbol} (${maximumProfile.maximumInputLots} lots).`);
  }
  const maximumInputRaw = scaleDexV2LotsToRaw(maximumInputLots, BigInt(input.lotSizeRaw));
  const displayedBase = token(manifest, selectedPair[0]).address;
  const canonicalHumanPrice = displayedBase.toLowerCase() === pair.token0.toLowerCase()
    ? displayedLimitPrice
    : 1 / displayedLimitPrice;
  const token0 = token(manifest, tokenSymbol(manifest, pair.token0));
  const token1 = token(manifest, tokenSymbol(manifest, pair.token1));
  const token0Lot = Number(formatDexV2LotsAsTokenAmount(1n, token0.decimals, BigInt(token0.lotSizeRaw)));
  const token1Lot = Number(formatDexV2LotsAsTokenAmount(1n, token1.decimals, BigInt(token1.lotSizeRaw)));
  const limitPriceQ = BigInt(Math.round(canonicalHumanPrice * token0Lot / token1Lot * Number(Q)));
  if (limitPriceQ <= 0n || limitPriceQ > 18_446_744_073_709_551_615n) {
    throw new Error('Price protection exceeds the private uint64 range.');
  }
  const buyToken0 = outputToken.toLowerCase() === pair.token0.toLowerCase();
  const indicativeOutput = buyToken0
    ? maximumInputLots * Q / limitPriceQ
    : maximumInputLots * limitPriceQ / Q;
  const minimumOutputLots = minimumPercent === 0
    ? 0n
    : (indicativeOutput * BigInt(minimumPercent) + 99n) / 100n;
  return Object.freeze({
    pair,
    inputSymbol,
    outputSymbol,
    inputToken,
    outputToken,
    inputDecimals: input.decimals,
    outputDecimals: output.decimals,
    inputLotSizeRaw: BigInt(input.lotSizeRaw),
    outputLotSizeRaw: BigInt(output.lotSizeRaw),
    maximumInputLots,
    maximumInputRaw,
    limitPriceQ,
    minimumOutputLots,
    buyToken0
  });
};

const ownerNonce = async (signer: JsonRpcSigner, manifest: SuccessorDexManifest, owner: string): Promise<bigint> => {
  const authorityAddress = manifest.contracts['work-authority']?.address;
  if (!authorityAddress) throw new Error('Successor work authority is missing from the manifest.');
  const authority = new Contract(authorityAddress, ABI, signer);
  return BigInt(await authority.getFunction('privateBookOwnerNonce').staticCall(owner));
};

export type ResumableSuccessorSwap = Readonly<{
  requestId: bigint;
  deadline: bigint;
  plan: SuccessorSwapPlan;
  progress: SuccessorSwapProgress;
  settled?: boolean;
  recovered?: boolean;
}>;

export const findResumableSuccessorSwap = async ({
  signer,
  manifest,
  pair
}: {
  signer: JsonRpcSigner;
  manifest: SuccessorDexManifest;
  pair: SuccessorDexPair;
}): Promise<ResumableSuccessorSwap | null> => {
  const owner = getAddress(await signer.getAddress());
  const authority = manifest.contracts['work-authority']?.address;
  if (!authority) throw new Error('Successor work authority is missing from the manifest.');
  const logs = await submissionLogs(signer, manifest, owner);
  for (const log of [...logs].reverse()) {
    const parsedEvent = EVENTS.parseLog({ topics: [...log.topics], data: log.data });
    const transaction = await signer.provider.getTransaction(log.transactionHash);
    if (!parsedEvent || !transaction || transaction.to?.toLowerCase() !== authority.toLowerCase()) continue;
    const parsedCall = EVENTS.parseTransaction({ data: transaction.data, value: transaction.value });
    if (!parsedCall || parsedCall.name !== 'submitPrivateBook' ||
        String(parsedCall.args[1]).toLowerCase() !== pair.marketKey.toLowerCase()) continue;
    const requestId = BigInt(parsedEvent.args[0]);
    const progress = await readSuccessorSwapProgress({ signer, manifest, pair, requestId });
    const terminalState = progress.terminalState;
    if (progress.workClosed && progress.workCredit === 0n && terminalState) {
      const aesKey = signer.getUserOnboardInfo()?.aesKey?.trim();
      if (aesKey) {
        const core = new Contract(manifest.globalCore, CORE_ABI, signer);
        const buyToken0 = Boolean(parsedCall.args[2]);
        const inputToken = buyToken0 ? pair.token1 : pair.token0;
        const outputToken = buyToken0 ? pair.token0 : pair.token1;
        const [inputCredit, outputCredit] = await Promise.all([
          core.getFunction('reencryptMyDirectCredit').staticCall(inputToken),
          core.getFunction('reencryptMyDirectCredit').staticCall(outputToken)
        ]);
        if (
          BigInt(decryptUint(userCiphertext(inputCredit), aesKey)) === 0n &&
          BigInt(decryptUint(userCiphertext(outputCredit), aesKey)) === 0n
        ) continue;
      }
    }
    const buyToken0 = Boolean(parsedCall.args[2]);
    const inputToken = buyToken0 ? pair.token1 : pair.token0;
    const outputToken = buyToken0 ? pair.token0 : pair.token1;
    const input = token(manifest, tokenSymbol(manifest, inputToken));
    const output = token(manifest, tokenSymbol(manifest, outputToken));
    return Object.freeze({
      requestId,
      deadline: BigInt(parsedEvent.args[4]),
      progress,
      settled: terminalState === 'settled',
      recovered: terminalState === 'recovered',
      plan: Object.freeze({
        pair,
        inputSymbol: tokenSymbol(manifest, inputToken),
        outputSymbol: tokenSymbol(manifest, outputToken),
        inputToken,
        outputToken,
        inputDecimals: input.decimals,
        outputDecimals: output.decimals,
        inputLotSizeRaw: BigInt(input.lotSizeRaw),
        outputLotSizeRaw: BigInt(output.lotSizeRaw),
        maximumInputLots: 0n,
        maximumInputRaw: 0n,
        limitPriceQ: 0n,
        minimumOutputLots: 0n,
        buyToken0
      })
    });
  }
  return null;
};

export const submitSuccessorSwap = async ({
  signer,
  manifest,
  plan
}: {
  signer: JsonRpcSigner;
  manifest: SuccessorDexManifest;
  plan: SuccessorSwapPlan;
}): Promise<Readonly<{ requestId: bigint; deadline: bigint; transactionHash: string }>> => {
  const owner = getAddress(await signer.getAddress());
  const authorityAddress = manifest.contracts['work-authority']?.address;
  if (!authorityAddress) throw new Error('Successor work authority is missing from the manifest.');
  const authority = new Contract(authorityAddress, ABI, signer);
  const nonce = await ownerNonce(signer, manifest, owner);
  await ensureTradeTokenAllowance(
    signer,
    owner,
    plan.inputToken,
    plan.maximumInputRaw,
    'private-erc20',
    manifest.globalCore
  );
  const selector = authority.interface.getFunction('submitPrivateBook')!.selector;
  const encrypt = (plaintext: bigint) => encryptAuthenticatedUint64Input(signer, {
    plaintext,
    contractAddress: authorityAddress,
    functionSelector: selector
  });
  const config = await authority.getFunction('privateBookWorkConfig').staticCall(plan.pair.marketKey);
  const maximumInput = await encrypt(plan.maximumInputLots);
  const limitPriceQ = await encrypt(plan.limitPriceQ);
  const minimumOutput = await encrypt(plan.minimumOutputLots);
  const transaction = await authority.submitPrivateBook(
    owner,
    plan.pair.marketKey,
    plan.buyToken0,
    nonce,
    maximumInput,
    limitPriceQ,
    minimumOutput,
    { value: BigInt(config[1]), gasLimit: SUCCESSOR_DEX_GAS_LIMIT }
  );
  const receipt = await transaction.wait(1);
  if (!receipt || receipt.status !== 1) throw new Error('Successor Swap submission failed.');
  const matches = receipt.logs.flatMap((log: { address: string; topics: readonly string[]; data: string }) => {
    if (log.address.toLowerCase() !== manifest.globalCore.toLowerCase()) return [];
    try {
      const parsed = EVENTS.parseLog({ topics: [...log.topics], data: log.data });
      return parsed?.name === 'PrivateBookSubmitted' && String(parsed.args[1]).toLowerCase() === owner.toLowerCase()
        ? [Object.freeze({ requestId: BigInt(parsed.args[0]), deadline: BigInt(parsed.args[4]) })]
        : [];
    } catch {
      return [];
    }
  });
  if (matches.length !== 1) throw new Error('Successor Swap receipt did not contain one matching request.');
  return Object.freeze({ ...matches[0], transactionHash: transaction.hash });
};

export const readSuccessorSwapProgress = async ({
  signer,
  manifest,
  pair,
  requestId
}: {
  signer: JsonRpcSigner;
  manifest: SuccessorDexManifest;
  pair: SuccessorDexPair;
  requestId: bigint;
}): Promise<SuccessorSwapProgress> => {
  const authority = new Contract(manifest.contracts['work-authority'].address, ABI, signer);
  const owner = await signer.getAddress();
  const processedEvent = EVENTS.getEvent('PrivateBookProcessed')!;
  const recoveredEvent = EVENTS.getEvent('PrivateBookRecovered')!;
  const [state, workCredit, latestBlock, processedLogs, recoveredLogs] = await Promise.all([
    authority.getFunction('privateBookWorkState').staticCall(requestId),
    authority.getFunction('privateBookWorkCredit').staticCall(owner),
    signer.provider.getBlockNumber(),
    signer.provider.getLogs({
      address: manifest.globalCore,
      fromBlock: manifest.deploymentBlockRange[0],
      toBlock: 'latest',
      topics: EVENTS.encodeFilterTopics(processedEvent, [requestId, null])
    }),
    signer.provider.getLogs({
      address: manifest.globalCore,
      fromBlock: manifest.deploymentBlockRange[0],
      toBlock: 'latest',
      topics: EVENTS.encodeFilterTopics(recoveredEvent, [requestId, null])
    })
  ]);
  if (processedLogs.length > 0 && recoveredLogs.length > 0) {
    throw new Error('Successor Swap has conflicting terminal events.');
  }
  return Object.freeze({
    workCursor: Number(state[0]),
    settlementCursor: 23 * pair.sourceCount + 2,
    cleanupCursor: Number(state[1]),
    sourceCount: pair.sourceCount,
    recoveryCleanup: Boolean(state[2]),
    workRevision: BigInt(state[4]),
    workClosed: Boolean(state[3]),
    remainingEscrow: BigInt(state[5]),
    workCredit: BigInt(workCredit),
    latestBlock: BigInt(latestBlock),
    terminalState: recoveredLogs.length > 0 ? 'recovered' : processedLogs.length > 0 ? 'settled' : null
  });
};

export const nextSuccessorSwapAction = ({
  progress,
  deadline,
  currentBlock
}: {
  progress: SuccessorSwapProgress;
  deadline: bigint;
  currentBlock: bigint;
}): SuccessorSwapWorkAction => {
  if (progress.workClosed) return progress.workCredit === 0n ? 'complete' : 'withdraw-credit';
  if (progress.recoveryCleanup || progress.workCursor > progress.settlementCursor) return 'cleanup';
  if (currentBlock >= deadline) return 'recover';
  return progress.workCursor === progress.settlementCursor ? 'settle' : 'advance';
};

export const processSuccessorSwapFrame = async ({
  signer,
  manifest,
  pair,
  requestId,
  deadline
}: {
  signer: JsonRpcSigner;
  manifest: SuccessorDexManifest;
  pair: SuccessorDexPair;
  requestId: bigint;
  deadline: bigint;
}): Promise<Readonly<{ progress: SuccessorSwapProgress; transactionHash: string; action: SuccessorSwapWorkAction }>> => {
  const authority = new Contract(manifest.contracts['work-authority'].address, ABI, signer);
  const before = await readSuccessorSwapProgress({ signer, manifest, pair, requestId });
  const action = nextSuccessorSwapAction({
    progress: before,
    deadline,
    currentBlock: before.latestBlock
  });
  if (action === 'complete') return Object.freeze({ progress: before, transactionHash: '', action });
  const transaction = action === 'settle'
    ? await authority.settlePrivateBook(requestId, INITIAL_REQUEST_REVISION, { gasLimit: SUCCESSOR_DEX_GAS_LIMIT })
    : action === 'recover'
      ? await authority.recoverPrivateBook(requestId, INITIAL_REQUEST_REVISION, { gasLimit: SUCCESSOR_DEX_GAS_LIMIT })
      : action === 'withdraw-credit'
        ? await authority.withdrawPrivateBookWorkCredit({ gasLimit: SUCCESSOR_DEX_GAS_LIMIT })
        : await authority.advancePrivateBookWork(requestId, before.workRevision, { gasLimit: SUCCESSOR_DEX_GAS_LIMIT });
  const receipt = await transaction.wait(1);
  if (!receipt || receipt.status !== 1) throw new Error('Successor Swap work transaction failed.');
  return Object.freeze({
    progress: await readSuccessorSwapProgress({ signer, manifest, pair, requestId }),
    transactionHash: transaction.hash,
    action
  });
};

function userCiphertext(value: unknown): bigint {
  const tuple = value as Record<string | number, unknown>;
  return BigInt(String(tuple.userCiphertext ?? tuple[1]));
}

export const revealSuccessorSwapReceipt = async ({
  signer,
  manifest,
  requestId,
  maximumInputLots
}: {
  signer: JsonRpcSigner;
  manifest: SuccessorDexManifest;
  requestId: bigint;
  maximumInputLots?: bigint;
}): Promise<SuccessorSwapReceipt> => {
  const aesKey = signer.getUserOnboardInfo()?.aesKey?.trim();
  if (!aesKey) throw new Error('Unlock privacy before revealing the Swap receipt.');
  const authority = new Contract(manifest.contracts['work-authority'].address, ABI, signer);
  const encoded = await authority.getFunction('reencryptMyPrivateBookReceipt').staticCall(requestId);
  const [receipt] = RECEIPT.decode([
    'tuple(tuple(uint256 ciphertext,uint256 userCiphertext) inputUsed,tuple(uint256 ciphertext,uint256 userCiphertext) grossOutput,tuple(uint256 ciphertext,uint256 userCiphertext) refund,tuple(uint256 ciphertext,uint256 userCiphertext) netOutput,tuple(uint256 ciphertext,uint256 userCiphertext) fee,tuple(uint256 ciphertext,uint256 userCiphertext) invalid,tuple(uint256 ciphertext,uint256 userCiphertext) directUnavailable,uint64 requestRevision)'
  ], encoded);
  const reveal = (value: unknown) => BigInt(decryptUint(userCiphertext(value), aesKey));
  const inputUsed = reveal(receipt.inputUsed ?? receipt[0]);
  const refund = reveal(receipt.refund ?? receipt[2]);
  const netOutput = reveal(receipt.netOutput ?? receipt[3]);
  const fee = reveal(receipt.fee ?? receipt[4]);
  const invalidValue = reveal(receipt.invalid ?? receipt[5]);
  const directUnavailableValue = reveal(receipt.directUnavailable ?? receipt[6]);
  const observedMaximum = inputUsed + refund;
  if ((invalidValue !== 0n && invalidValue !== 1n) ||
      (directUnavailableValue !== 0n && directUnavailableValue !== 1n) ||
      observedMaximum === 0n ||
      observedMaximum > BigInt(manifest.privateBookWorkProfile.maximumInputLots) ||
      (maximumInputLots !== undefined && observedMaximum !== maximumInputLots)) {
    throw new Error('Successor Swap receipt failed its conservation check.');
  }
  return Object.freeze({
    inputUsed,
    netOutput,
    refund,
    fee,
    invalid: invalidValue === 1n,
    directUnavailable: directUnavailableValue === 1n
  });
};

export const withdrawSuccessorSwapCredit = async ({
  signer,
  manifest,
  token: tokenAddress,
  amountLots
}: {
  signer: JsonRpcSigner;
  manifest: SuccessorDexManifest;
  token: string;
  amountLots?: bigint;
}): Promise<Readonly<{ amountLots: bigint; transactionHash: string }>> => {
  const owner = getAddress(await signer.getAddress());
  const aesKey = signer.getUserOnboardInfo()?.aesKey?.trim();
  if (!aesKey) throw new Error('Unlock privacy before withdrawing the Swap credit.');
  const core = new Contract(manifest.globalCore, CORE_ABI, signer);
  const [ownerNonceValue, creditRevision, ownerCredit] = await Promise.all([
    core.getFunction('directOwnerNonces').staticCall(owner),
    core.getFunction('directCreditRevision').staticCall(owner, tokenAddress),
    core.getFunction('reencryptMyDirectCredit').staticCall(tokenAddress)
  ]);
  const available = BigInt(decryptUint(userCiphertext(ownerCredit), aesKey));
  if (available < 0n || available > UINT64_MAX || amountLots !== undefined && (amountLots <= 0n || amountLots > UINT64_MAX)) {
    throw new Error('The private Swap credit amount is unavailable or exceeds uint64.');
  }
  const amount = amountLots === undefined || amountLots > available ? available : amountLots;
  if (amount === 0n) return Object.freeze({ amountLots: 0n, transactionHash: '' });
  const selector = CORE.getFunction('withdrawDirectCredit')!.selector;
  const encrypted = await encryptAuthenticatedUint64Input(signer, {
    plaintext: amount,
    contractAddress: manifest.globalCore,
    functionSelector: selector
  });
  const transaction = await core.withdrawDirectCredit(
    tokenAddress,
    creditRevision,
    ownerNonceValue,
    encrypted,
    { gasLimit: SUCCESSOR_DEX_GAS_LIMIT }
  );
  const receipt = await transaction.wait(1);
  if (!receipt || receipt.status !== 1) throw new Error('Successor Swap credit withdrawal failed.');
  return Object.freeze({ amountLots: amount, transactionHash: transaction.hash });
};
