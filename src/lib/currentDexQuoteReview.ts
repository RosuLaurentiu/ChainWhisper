import { Interface, formatUnits, parseUnits } from '@coti-io/coti-ethers';
import type { issueCurrentDexReceiptCapability } from '../features/wallet/currentDexReceiptCapability';
import type { TradeActionConfirmModel } from './tradeActionConfirm';
import type { CurrentCheapDexProfile } from './currentDexOperation';
import { currentCheapDexCandidateKey, resolveCurrentCheapDexCandidate, currentCheapDexQuoteProtocol, type CurrentCheapDexIdentity } from './dexV2Deployment';

type ReceiptCapability = Awaited<ReturnType<typeof issueCurrentDexReceiptCapability>>;
type Receipt = Awaited<ReturnType<ReceiptCapability['read'] | ReceiptCapability['readCurrent']>>;
type Intent = Readonly<{
  candidate?: CurrentCheapDexIdentity;
  chainId: bigint; core: string; runtimeHash: string; releaseId: string; principal: string;
  operationId: bigint; contextHash: string; deadline: bigint;
  maximumInput: bigint; minimumOutput: bigint; rateNumerator: bigint; rateDenominator: bigint;
  profile?: CurrentCheapDexProfile; minimumInput?: bigint;
  quoteProtocol?: 'quote-slippage'; toleranceBps?: number;
}>;
export const CURRENT_DEX_ACCEPT_ABI = ['function acceptPrivateSwapV1(uint256 operationId,bytes32 expectedContext)',
  'function acceptFastPoolV1(uint256 quoteId,bytes32 expectedContext)'] as const;
const acceptInterface = new Interface(CURRENT_DEX_ACCEPT_ABI);
export const CURRENT_SLIPPAGE_DEX_ACCEPT_ABI = ['function acceptFastPool(uint256 quoteId,bytes32 expectedContext)',
  CURRENT_DEX_ACCEPT_ABI[0]] as const;
const slippageAcceptInterface = new Interface(CURRENT_SLIPPAGE_DEX_ACCEPT_ABI);
export const DEFAULT_CURRENT_DEX_SLIPPAGE_PERCENT = '0.5';
export const parseCurrentDexSlippagePercent = (value: string): number => {
  if (!/^(0|[1-9][0-9]*)(?:\.[0-9]{1,2})?$/.test(value.trim())) {
    throw new Error('Slippage: enter a percentage from 0 to 100, with at most two decimal places.');
  }
  const basisPoints = parseUnits(value.trim(), 2);
  if (basisPoints > 10000n) throw new Error('Slippage: enter a percentage from 0 to 100.');
  return Number(basisPoints);
};
export class CurrentDexQuoteProtectionError extends Error {
  constructor(readonly review: TradeActionConfirmModel) {
    super(`Quote does not meet the submitted protections. ${review.message}`);
    this.name = 'CurrentDexQuoteProtectionError';
  }
}
const uint = (value: bigint, bits = 256) => {
  if (typeof value !== 'bigint' || value < 0n || value >= 1n << BigInt(bits)) throw new Error('Invalid quote review integer.');
};

// Display validation only: does not attest deployment or issue acceptance authority.
export const buildCurrentDexQuoteReview = ({ receipt, intent, now, input, output }: {
  receipt: Receipt; intent: Intent; now: bigint;
  input: Readonly<{ symbol: string; decimals: number }>;
  output: Readonly<{ symbol: string; decimals: number }>;
}): TradeActionConfirmModel => {
  if (receipt.candidate && !intent.candidate) throw new Error('Private Quote review requires its exact candidate.');
  if (intent.candidate) {
    const c = resolveCurrentCheapDexCandidate(currentCheapDexCandidateKey(intent.candidate));
    if (intent.core.toLowerCase() !== c.core || intent.chainId !== BigInt(c.chainId) || intent.releaseId !== c.releaseId ||
        intent.runtimeHash !== c.runtimes.find(([role]) => role === 'ChainWhisperDexCore')![2] ||
        intent.quoteProtocol !== currentCheapDexQuoteProtocol(c) || !receipt.candidate ||
        currentCheapDexCandidateKey(receipt.candidate) !== currentCheapDexCandidateKey(c)) {
      throw new Error('Private Quote review differs from its exact candidate.');
    }
  }
  for (const value of [now, intent.chainId, intent.operationId, intent.deadline, intent.maximumInput, intent.minimumOutput]) uint(value);
  uint(intent.rateNumerator, 128); uint(intent.rateDenominator, 128);
  if (intent.profile !== undefined && intent.profile !== 'fast-pool' && intent.profile !== 'cheap-async') throw new Error('Invalid quote profile.');
  if (intent.quoteProtocol !== undefined && intent.quoteProtocol !== 'quote-slippage') throw new Error('Invalid quote protocol.');
  const slippage = intent.quoteProtocol === 'quote-slippage';
  if (slippage ? intent.profile === undefined || !Number.isInteger(intent.toleranceBps) ||
      intent.toleranceBps! < 0 || intent.toleranceBps! > 10000 : intent.toleranceBps !== undefined) {
    throw new Error('Quote tolerance is not bound to its protocol.');
  }
  const minimumInput = intent.minimumInput ?? 0n;
  uint(minimumInput);
  if ((intent.profile !== undefined && intent.minimumInput === undefined) || minimumInput > intent.maximumInput) throw new Error('Invalid minimum fill.');
  // Zero numerator disables only the optional hard floor on the new protocol.
  // Quote-relative slippage is still authorized before Quote and checked on-chain.
  if ((!intent.rateNumerator && !slippage) || !intent.rateDenominator) throw new Error('Invalid minimum price.');
  for (const token of [input, output]) {
    if (!Number.isInteger(token.decimals) || token.decimals < 0 || token.decimals > 255 || !token.symbol.trim()) throw new Error('Invalid quote token metadata.');
  }
  if (receipt.chainId !== intent.chainId || receipt.operationId !== intent.operationId ||
      receipt.core.toLowerCase() !== intent.core.toLowerCase() || receipt.principal.toLowerCase() !== intent.principal.toLowerCase() ||
      receipt.runtimeHash.toLowerCase() !== intent.runtimeHash.toLowerCase() || receipt.releaseId.toLowerCase() !== intent.releaseId.toLowerCase() ||
      receipt.operation.contextHash.toLowerCase() !== intent.contextHash.toLowerCase() || receipt.operation.deadline !== intent.deadline) {
    throw new Error('Quote does not match the submitted intent.');
  }
  const ready = intent.profile === undefined
    ? 'status' in receipt.operation && receipt.operation.status === 2 && receipt.operation.quotePrepared && !receipt.operation.funded
    : 'profile' in receipt.operation && receipt.operation.profile === intent.profile && receipt.operation.ready && receipt.operation.phase === 'quote-prepared';
  if (receipt.kind !== 'quote' || !ready ||
      now < receipt.block.timestamp || now >= intent.deadline) throw new Error('Quote is not available for acceptance.');
  const a = receipt.amounts;
  for (const value of [a.maximumInput, a.actualInput, a.refund, a.grossOutput, a.fee, a.netOutput]) uint(value);
  if (a.maximumInput !== intent.maximumInput || a.actualInput + a.refund !== a.maximumInput ||
      a.fee + a.netOutput !== a.grossOutput ||
      (!a.filled && (a.actualInput !== 0n || a.grossOutput !== 0n)) ||
      (a.filled && (a.actualInput === 0n || a.netOutput === 0n))) {
    throw new Error('Quote accounting does not match the submitted intent.');
  }
  const inAmount = (value: bigint) => `${formatUnits(value, input.decimals)} ${input.symbol}`;
  const outAmount = (value: bigint) => `${formatUnits(value, output.decimals)} ${output.symbol}`;
  const model: TradeActionConfirmModel = {
    title: 'Review private quote', primaryLabel: 'Accept quote', fundingMoves: [],
    message: 'Expected amounts, after fees.',
    summaryRows: [
      { label: 'You pay', value: inAmount(a.actualInput) },
      { label: 'You receive', value: outAmount(a.netOutput) },
      { label: 'Average price', value: a.actualInput === 0n ? 'Unavailable (no fill)' : `${formatUnits(a.netOutput * 10n ** BigInt(input.decimals + 8) / (a.actualInput * 10n ** BigInt(output.decimals)), 8)} ${output.symbol} per ${input.symbol} (rounded down)` }
    ],
    stats: []
  };
  const failures = [];
  if (!a.filled) failures.push('No fill is available under these terms. The receipt has no price for an unprotected trade.');
  else {
    if (a.actualInput < minimumInput) failures.push(`Below your minimum fill of ${inAmount(minimumInput)}.`);
    if (a.netOutput < intent.minimumOutput) failures.push(`Below your minimum output of ${outAmount(intent.minimumOutput)}.`);
    if (a.netOutput * intent.rateDenominator < a.actualInput * intent.rateNumerator) failures.push('The net exchange rate does not meet your price limit.');
  }
  if (failures.length) throw new CurrentDexQuoteProtectionError({ ...model,
    title: 'Quote cannot be accepted', primaryLabel: 'Close', secondaryLabel: null,
    message: `${failures.join(' ')} No swap was sent.` });
  return model;
};

/** Human review handoff only. No signing, allowance, deployment admission or transaction submission. */
export const prepareCurrentDexAcceptance = async ({ intent, input, output, readReceipt, now, confirm }: {
  intent: Intent;
  input: Readonly<{ symbol: string; decimals: number }>;
  output: Readonly<{ symbol: string; decimals: number }>;
  readReceipt: () => Promise<Receipt>;
  now: () => bigint;
  confirm: (model: TradeActionConfirmModel) => Promise<boolean>;
}) => {
  const captured = Object.freeze({ ...intent }), inputToken = Object.freeze({ ...input }), outputToken = Object.freeze({ ...output });
  const receipt = await readReceipt();
  const model = buildCurrentDexQuoteReview({ receipt, intent: captured, input: inputToken, output: outputToken, now: now() });
  const reviewedAmounts = { ...receipt.amounts }, reviewedBlock = { ...receipt.block };
  if (!await confirm(model)) return null;
  // User review takes time. Re-read instead of accepting the earlier snapshot blindly.
  const refreshed = await readReceipt();
  buildCurrentDexQuoteReview({ receipt: refreshed, intent: captured, input: inputToken, output: outputToken, now: now() });
  for (const key of Object.keys(reviewedAmounts) as Array<keyof Receipt['amounts']>) {
    if (refreshed.amounts[key] !== reviewedAmounts[key]) throw new Error('Quote changed during review. Review it again.');
  }
  if (refreshed.block.number < reviewedBlock.number ||
      (refreshed.block.number === reviewedBlock.number && refreshed.block.hash !== reviewedBlock.hash)) {
    throw new Error('Quote block changed during review.');
  }
  return Object.freeze({ chainId: captured.chainId, from: captured.principal, to: captured.core, value: 0n,
    data: (captured.quoteProtocol === 'quote-slippage' ? slippageAcceptInterface : acceptInterface)
      .encodeFunctionData(captured.profile === 'fast-pool'
        ? captured.quoteProtocol === 'quote-slippage' ? 'acceptFastPool' : 'acceptFastPoolV1'
        : 'acceptPrivateSwapV1', [captured.operationId, captured.contextHash]),
    readyToSign: false as const, operationId: captured.operationId, contextHash: captured.contextHash,
    reviewedBlock: Object.freeze({ ...refreshed.block }) });
};
