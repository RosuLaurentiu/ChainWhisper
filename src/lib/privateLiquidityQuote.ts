import {
  PRIVATE_LIQUIDITY_V1_MAX_SWAP_POSITIONS,
  buildPrivateLiquidityPairKey,
  buildPrivateLiquidityPositionKey,
  normalizePrivateLiquidityAddress,
  parsePrivateLiquidityUint,
  validatePrivateLiquidityPosition,
  validatePrivateLiquidityTerms,
  type PrivateLiquidityDirection,
  type PrivateLiquidityPosition,
  type PrivateLiquiditySideTerms
} from './privateLiquidity';

export type PrivateLiquidityCandidate = Readonly<{
  key: string;
  positionId: string;
  expectedRevision: string;
  terms: PrivateLiquiditySideTerms;
  owner: string;
}>;

export type PrivateLiquidityCandidatePlan = Readonly<{
  direction: PrivateLiquidityDirection;
  chainId: string;
  contractAddress: string;
  pairKey: string;
  baseToken: string;
  quoteToken: string;
  candidates: readonly PrivateLiquidityCandidate[];
  eligiblePositionCount: number;
  omittedPositionCount: number;
  candidateSetComplete: boolean;
  bestMarginalTerms: PrivateLiquiditySideTerms | null;
  canClaimGlobalBestExecution: false;
}>;

export type PreparePrivateLiquidityCandidatesInput = Readonly<{
  chainId: string;
  contractAddress: string;
  baseToken: string;
  quoteToken: string;
  direction: PrivateLiquidityDirection;
  positions: readonly PrivateLiquidityPosition[];
  maxCandidates?: number;
}>;

export type PrivateLiquiditySwapQuote = Readonly<{
  direction: PrivateLiquidityDirection;
  pairKey: string;
  maximumInput: string;
  minimumInputFilled: string;
  minimumFillBps: number;
  bestFullFillOutput: string;
  limitFullFillOutput: string;
  slippageBps: number;
  bestTerms: PrivateLiquiditySideTerms;
  limitTerms: PrivateLiquiditySideTerms;
  candidates: readonly PrivateLiquidityCandidate[];
  selectedCandidateCount: number;
  candidateSetComplete: boolean;
  omittedPositionCount: number;
  exactCapacityKnown: false;
  executionPolicy: 'partial-fill-to-price-limit';
  unusedInputStaysInWallet: true;
  packedSwapValue: string;
}>;

export type PreparePrivateLiquiditySwapQuoteInput = Readonly<{
  plan: PrivateLiquidityCandidatePlan;
  inputAmount: bigint | number | string;
  slippageBps: number;
  minimumFillBps: number;
}>;

const UINT128_MAX = (1n << 128n) - 1n;
const PACK_BASE = 1n << 128n;
const BPS_BASE = 10_000n;

const parseQuoteUint = (value: bigint | number | string, label: string): bigint => {
  if (typeof value === 'number' && (!Number.isSafeInteger(value) || value < 0)) {
    throw new Error(`${label} must be a safe unsigned integer.`);
  }
  const normalized = typeof value === 'string' ? value : value.toString();
  return parsePrivateLiquidityUint(normalized, label);
};

const compareTerms = (
  left: PrivateLiquiditySideTerms,
  right: PrivateLiquiditySideTerms
): -1 | 0 | 1 => {
  const leftTerms = validatePrivateLiquidityTerms(left, 'Left price');
  const rightTerms = validatePrivateLiquidityTerms(right, 'Right price');
  const leftCross = leftTerms.quoteAmount * rightTerms.baseAmount;
  const rightCross = rightTerms.quoteAmount * leftTerms.baseAmount;
  return leftCross < rightCross ? -1 : leftCross > rightCross ? 1 : 0;
};

const comparePositionIds = (left: string, right: string): -1 | 0 | 1 => {
  const leftId = parsePrivateLiquidityUint(left, 'Left position ID');
  const rightId = parsePrivateLiquidityUint(right, 'Right position ID');
  return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
};

const normalizeMaxCandidates = (value: number | undefined): number => {
  const candidateLimit = value ?? PRIVATE_LIQUIDITY_V1_MAX_SWAP_POSITIONS;
  if (
    !Number.isSafeInteger(candidateLimit) ||
    candidateLimit <= 0 ||
    candidateLimit > PRIVATE_LIQUIDITY_V1_MAX_SWAP_POSITIONS
  ) {
    throw new Error(
      `Private-liquidity candidate limit must be between 1 and ${PRIVATE_LIQUIDITY_V1_MAX_SWAP_POSITIONS}.`
    );
  }
  return candidateLimit;
};

const outputAtTerms = (
  inputAmount: bigint,
  terms: PrivateLiquiditySideTerms,
  direction: PrivateLiquidityDirection
): bigint => {
  const normalized = validatePrivateLiquidityTerms(terms, 'Quote terms');
  return direction === 'base-to-quote'
    ? (inputAmount * normalized.quoteAmount) / normalized.baseAmount
    : (inputAmount * normalized.baseAmount) / normalized.quoteAmount;
};

const isWithinSlippageLimit = (
  candidate: PrivateLiquiditySideTerms,
  best: PrivateLiquiditySideTerms,
  direction: PrivateLiquidityDirection,
  slippageBps: number
): boolean => {
  const candidateTerms = validatePrivateLiquidityTerms(candidate, 'Candidate price');
  const bestTerms = validatePrivateLiquidityTerms(best, 'Best price');
  const candidateCross = candidateTerms.quoteAmount * bestTerms.baseAmount;
  const bestCross = bestTerms.quoteAmount * candidateTerms.baseAmount;
  if (direction === 'base-to-quote') {
    return candidateCross * BPS_BASE >= bestCross * (BPS_BASE - BigInt(slippageBps));
  }
  return candidateCross * BPS_BASE <= bestCross * (BPS_BASE + BigInt(slippageBps));
};

export const preparePrivateLiquidityCandidates = ({
  chainId,
  contractAddress,
  baseToken,
  quoteToken,
  direction,
  positions,
  maxCandidates
}: PreparePrivateLiquidityCandidatesInput): PrivateLiquidityCandidatePlan => {
  const expectedChainId = parsePrivateLiquidityUint(chainId, 'Chain ID').toString();
  if (expectedChainId === '0') {
    throw new Error('Private-liquidity chain ID must be positive.');
  }
  const expectedContract = normalizePrivateLiquidityAddress(
    contractAddress,
    'Private-liquidity contract'
  );
  const expectedBase = normalizePrivateLiquidityAddress(baseToken, 'Base token');
  const expectedQuote = normalizePrivateLiquidityAddress(quoteToken, 'Quote token');
  const pairKey = buildPrivateLiquidityPairKey(expectedBase, expectedQuote);
  const candidateLimit = normalizeMaxCandidates(maxCandidates);
  const seen = new Set<string>();

  const eligible = positions.flatMap((position): PrivateLiquidityPosition[] => {
    validatePrivateLiquidityPosition(position);
    const key = buildPrivateLiquidityPositionKey(position.identity);
    if (seen.has(key)) {
      throw new Error(`Duplicate private-liquidity position ${key}.`);
    }
    seen.add(key);
    const identityChainId = parsePrivateLiquidityUint(
      position.identity.chainId,
      'Position chain ID'
    ).toString();
    const identityContract = normalizePrivateLiquidityAddress(
      position.identity.contractAddress,
      'Position contract'
    );
    if (
      identityChainId !== expectedChainId ||
      identityContract !== expectedContract ||
      position.baseToken.toLowerCase() !== expectedBase ||
      position.quoteToken.toLowerCase() !== expectedQuote ||
      position.pairKey.toLowerCase() !== pairKey.toLowerCase()
    ) {
      return [];
    }
    if (
      position.status !== 'active' ||
      position.privacyOwner === null ||
      (direction === 'base-to-quote'
        ? !position.buySideAvailable
        : !position.sellSideAvailable)
    ) {
      return [];
    }
    return [position];
  });

  eligible.sort((left, right) => {
    const leftTerms = direction === 'base-to-quote' ? left.buyTerms : left.sellTerms;
    const rightTerms = direction === 'base-to-quote' ? right.buyTerms : right.sellTerms;
    const priceOrder = compareTerms(leftTerms, rightTerms);
    if (priceOrder !== 0) {
      return direction === 'base-to-quote' ? -priceOrder : priceOrder;
    }
    return comparePositionIds(left.identity.positionId, right.identity.positionId);
  });

  const selected = eligible.slice(0, candidateLimit);
  const candidates = selected.map((position): PrivateLiquidityCandidate =>
    Object.freeze({
      key: buildPrivateLiquidityPositionKey(position.identity),
      positionId: parsePrivateLiquidityUint(
        position.identity.positionId,
        'Position ID'
      ).toString(),
      expectedRevision: parsePrivateLiquidityUint(
        position.revision,
        'Position revision'
      ).toString(),
      terms: direction === 'base-to-quote' ? position.buyTerms : position.sellTerms,
      owner: normalizePrivateLiquidityAddress(position.owner, 'Position owner')
    })
  );
  const omittedPositionCount = eligible.length - candidates.length;

  return Object.freeze({
    direction,
    chainId: expectedChainId,
    contractAddress: expectedContract,
    pairKey,
    baseToken: expectedBase,
    quoteToken: expectedQuote,
    candidates: Object.freeze(candidates),
    eligiblePositionCount: eligible.length,
    omittedPositionCount,
    candidateSetComplete: omittedPositionCount === 0,
    bestMarginalTerms: candidates[0]?.terms ?? null,
    // Complete indexer discovery is still not an on-chain proof that no better position was omitted.
    canClaimGlobalBestExecution: false
  });
};

/**
 * Produces a public-price limit plan without pretending to know private depth. The high uint128 is
 * the trader's maximum input and the low uint128 is the minimum input that must actually fill. The
 * contract walks only the returned best-price-first candidates, spends the matched amount, and
 * leaves any unused maximum input in the trader's wallet.
 */
export const preparePrivateLiquiditySwapQuote = ({
  plan,
  inputAmount,
  slippageBps,
  minimumFillBps
}: PreparePrivateLiquiditySwapQuoteInput): PrivateLiquiditySwapQuote => {
  if (!plan || plan.candidates.length === 0) {
    throw new Error('A private-liquidity swap requires at least one selected candidate.');
  }
  const input = parseQuoteUint(inputAmount, 'Private-liquidity input amount');
  if (input === 0n || input > UINT128_MAX) {
    throw new Error('Private-liquidity input amount must be between 1 and uint128 max.');
  }
  if (!Number.isSafeInteger(slippageBps) || slippageBps < 0 || slippageBps >= 10_000) {
    throw new Error('Private-liquidity slippage must be between 0 and 9,999 basis points.');
  }
  if (!Number.isSafeInteger(minimumFillBps) || minimumFillBps < 0 || minimumFillBps > 10_000) {
    throw new Error('Private-liquidity minimum fill must be between 0 and 10,000 basis points.');
  }
  const bestTerms = plan.candidates[0].terms;
  const candidates = plan.candidates.filter(({ terms }) =>
    isWithinSlippageLimit(terms, bestTerms, plan.direction, slippageBps)
  );
  const limitTerms = candidates[candidates.length - 1].terms;
  const bestFullFillOutput = outputAtTerms(input, bestTerms, plan.direction);
  if (bestFullFillOutput === 0n) {
    throw new Error('Private-liquidity input is too small to produce output at the best public price.');
  }

  // This is a conditional full-fill bound, not a capacity estimate. Splitting one maximum input
  // over k integer-priced fills can lose at most k-1 smallest output units versus applying the
  // selected limit price once.
  const outputAtLimit = outputAtTerms(input, limitTerms, plan.direction);
  const roundingLoss = BigInt(candidates.length - 1);
  const limitFullFillOutput = outputAtLimit > roundingLoss
    ? outputAtLimit - roundingLoss
    : 1n;
  const minimumInputFilled = minimumFillBps === 0
    ? 0n
    : (input * BigInt(minimumFillBps) + BPS_BASE - 1n) / BPS_BASE;

  return Object.freeze({
    direction: plan.direction,
    pairKey: plan.pairKey,
    maximumInput: input.toString(),
    minimumInputFilled: minimumInputFilled.toString(),
    minimumFillBps,
    bestFullFillOutput: bestFullFillOutput.toString(),
    limitFullFillOutput: limitFullFillOutput.toString(),
    slippageBps,
    bestTerms,
    limitTerms,
    candidates: Object.freeze(candidates),
    selectedCandidateCount: candidates.length,
    candidateSetComplete: plan.candidateSetComplete,
    omittedPositionCount: plan.omittedPositionCount,
    exactCapacityKnown: false,
    executionPolicy: 'partial-fill-to-price-limit',
    unusedInputStaysInWallet: true,
    packedSwapValue: (input * PACK_BASE + minimumInputFilled).toString()
  });
};
