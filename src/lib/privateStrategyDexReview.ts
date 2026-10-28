export const PRIVATE_STRATEGY_DEX_PRICE_SCALE = 100_000_000n;
export const PRIVATE_STRATEGY_DEX_MAX_LIMIT_PRICE_Q = 100_000_000_000n;
export const PRIVATE_STRATEGY_DEX_MAX_INPUT_LOTS = (1n << 20n) - 1n;

const UINT32_MAX = (1n << 32n) - 1n;
const BYTES32 = /^0x[0-9a-f]{64}$/u;

export type PrivateStrategyDexDirection = 'buy-base' | 'sell-base';

export type PrivateStrategyDexReviewInput = Readonly<{
  pairKey: string;
  direction: PrivateStrategyDexDirection;
  maximumInputLots: bigint;
  minimumInputFilledLots: bigint;
  limitPriceQ: bigint;
  pairRevision: bigint;
  deadline: bigint;
  indicativeOutputLots?: bigint;
}>;

export type PrivateStrategyDexReview = Readonly<{
  pairKey: string;
  direction: PrivateStrategyDexDirection;
  maximumInputLots: bigint;
  minimumInputFilledLots: bigint;
  limitPriceQ: bigint;
  pairRevision: bigint;
  deadline: bigint;
  packedPrivateRequest: bigint;
  indicative: Readonly<{
    outputLots: bigint | null;
    authority: 'public-marginal-guidance-only';
    exactBeforeMining: false;
  }>;
  settlement: Readonly<{
    authority: 'canonical-mined-owner-private-receipt';
    reveals: readonly ['input-used', 'output', 'unused-input', 'invalid'];
  }>;
}>;

export type PrivateStrategyDexMinedReceipt = Readonly<{
  source: 'canonical-mined-owner-private-receipt';
  inputUsedLots: bigint;
  outputAmountLots: bigint;
  unusedInputLots: bigint;
  invalid: boolean;
}>;

const assertInteger = (value: bigint, label: string): bigint => {
  if (typeof value !== 'bigint' || value < 0n) {
    throw new Error(`${label} must be a non-negative integer.`);
  }
  return value;
};

export const packPrivateStrategyDexRequest = (
  maximumInputLots: bigint,
  minimumInputFilledLots: bigint
): bigint => {
  const maximum = assertInteger(maximumInputLots, 'Maximum input');
  const minimum = assertInteger(minimumInputFilledLots, 'Minimum input filled');
  if (maximum === 0n || maximum > PRIVATE_STRATEGY_DEX_MAX_INPUT_LOTS) {
    throw new Error(`Maximum input must be between 1 and ${PRIVATE_STRATEGY_DEX_MAX_INPUT_LOTS} lots.`);
  }
  if (minimum > maximum) {
    throw new Error('Minimum input filled cannot exceed maximum input.');
  }
  if (maximum > UINT32_MAX || minimum > UINT32_MAX) {
    throw new Error('The private request fields must fit the reviewed uint32 packing.');
  }
  return (maximum << 32n) | minimum;
};

export const unpackPrivateStrategyDexRequest = (packedRequest: bigint): Readonly<{
  maximumInputLots: bigint;
  minimumInputFilledLots: bigint;
}> => {
  const packed = assertInteger(packedRequest, 'Packed private request');
  if (packed > ((1n << 64n) - 1n)) {
    throw new Error('Packed private request must fit uint64.');
  }
  return Object.freeze({
    maximumInputLots: packed >> 32n,
    minimumInputFilledLots: packed & UINT32_MAX
  });
};

export const buildPrivateStrategyDexReview = (
  input: PrivateStrategyDexReviewInput,
  nowSeconds: bigint
): PrivateStrategyDexReview => {
  const pairKey = input.pairKey.toLowerCase();
  if (!BYTES32.test(pairKey)) throw new Error('Pair key must be bytes32.');
  if (input.direction !== 'buy-base' && input.direction !== 'sell-base') {
    throw new Error('Swap direction is invalid.');
  }
  const limitPriceQ = assertInteger(input.limitPriceQ, 'Public limit price');
  if (limitPriceQ === 0n || limitPriceQ > PRIVATE_STRATEGY_DEX_MAX_LIMIT_PRICE_Q) {
    throw new Error('Public limit price is outside the reviewed range.');
  }
  const pairRevision = assertInteger(input.pairRevision, 'Pair revision');
  if (pairRevision === 0n) throw new Error('Pair revision must be finalized and non-zero.');
  const deadline = assertInteger(input.deadline, 'Deadline');
  const now = assertInteger(nowSeconds, 'Current time');
  if (deadline <= now) throw new Error('Deadline must be in the future.');
  const packedPrivateRequest = packPrivateStrategyDexRequest(
    input.maximumInputLots,
    input.minimumInputFilledLots
  );
  const indicativeOutputLots = input.indicativeOutputLots === undefined
    ? null
    : assertInteger(input.indicativeOutputLots, 'Indicative output');
  return Object.freeze({
    pairKey,
    direction: input.direction,
    maximumInputLots: input.maximumInputLots,
    minimumInputFilledLots: input.minimumInputFilledLots,
    limitPriceQ,
    pairRevision,
    deadline,
    packedPrivateRequest,
    indicative: Object.freeze({
      outputLots: indicativeOutputLots,
      authority: 'public-marginal-guidance-only' as const,
      exactBeforeMining: false as const
    }),
    settlement: Object.freeze({
      authority: 'canonical-mined-owner-private-receipt' as const,
      reveals: Object.freeze(['input-used', 'output', 'unused-input', 'invalid'] as const)
    })
  });
};

export const assertPrivateStrategyDexMinedReceipt = (
  review: PrivateStrategyDexReview,
  receipt: PrivateStrategyDexMinedReceipt
): PrivateStrategyDexMinedReceipt => {
  if (receipt.source !== 'canonical-mined-owner-private-receipt') {
    throw new Error('Exact settlement requires the canonical mined owner-private receipt.');
  }
  const inputUsed = assertInteger(receipt.inputUsedLots, 'Receipt input used');
  const output = assertInteger(receipt.outputAmountLots, 'Receipt output');
  const unused = assertInteger(receipt.unusedInputLots, 'Receipt unused input');
  if (inputUsed + unused !== review.maximumInputLots) {
    throw new Error('Receipt input used and unused input do not conserve the reviewed maximum.');
  }
  if (receipt.invalid) {
    if (inputUsed !== 0n || output !== 0n || unused !== review.maximumInputLots) {
      throw new Error('An invalid receipt must describe a complete atomic rollback.');
    }
    return receipt;
  }
  if (inputUsed < review.minimumInputFilledLots || inputUsed === 0n || output === 0n) {
    throw new Error('Receipt violates the reviewed private minimum-fill policy.');
  }
  const outputMultiplier = review.direction === 'buy-base'
    ? review.limitPriceQ
    : PRIVATE_STRATEGY_DEX_PRICE_SCALE;
  const inputMultiplier = review.direction === 'buy-base'
    ? PRIVATE_STRATEGY_DEX_PRICE_SCALE
    : review.limitPriceQ;
  if (output * outputMultiplier < inputUsed * inputMultiplier) {
    throw new Error('Receipt violates the reviewed public realized-price limit.');
  }
  return receipt;
};
