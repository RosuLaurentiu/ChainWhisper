export type DexLiquidityKind = 'limit' | 'pool' | 'recurring';
export type DexSwapDirection = 'base-to-quote' | 'quote-to-base';
export type DexLiquidityFinality = 'finalized' | 'pending';
export type DexLiquidityAvailability = 'available' | 'empty' | 'error' | 'loading';

/**
 * Public discovery projection only. Limit/Recurring prices, sides, inventories,
 * minimum fills, and match eligibility never enter the APP/API/MCP model.
 */
export type DexLiquiditySource = Readonly<{
  sourceId: string;
  kind: DexLiquidityKind;
  chainId: string;
  contractAddress: string;
  pairKey: string;
  publicMarginalPriceE18: string | null;
  active: boolean;
  finality: DexLiquidityFinality;
}>;

export type DexLiquidityPlan = Readonly<{
  chainId: string;
  pairKey: string;
  direction: DexSwapDirection;
  availability: DexLiquidityAvailability;
  canonicalSources: readonly DexLiquiditySource[];
  pendingSourceCount: number;
  sourceCounts: Readonly<Record<DexLiquidityKind, number>>;
  hiddenSourceCount: number;
  publicPoolSource: DexLiquiditySource | null;
  settlementPolicy: 'price-ordered-multi-source';
  routingPolicy: 'onchain-private-price-gc';
}>;

export type BuildDexLiquidityPlanInput = Readonly<{
  chainId: bigint | number | string;
  pairKey: string;
  direction: DexSwapDirection;
  sources: readonly DexLiquiditySource[];
  loading?: boolean;
  verificationError?: boolean;
}>;

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const BYTES32 = /^0x[0-9a-fA-F]{64}$/;
const UINT = /^(0|[1-9][0-9]*)$/;

const uint = (value: bigint | number | string, label: string): bigint => {
  if (typeof value === 'number' && (!Number.isSafeInteger(value) || value < 0)) {
    throw new Error(`${label} must be an unsigned integer.`);
  }
  const normalized = typeof value === 'string' ? value : value.toString();
  if (!UINT.test(normalized)) throw new Error(`${label} must be an unsigned integer.`);
  return BigInt(normalized);
};

const address = (value: string): string => {
  if (!ADDRESS.test(value)) throw new Error('DEX liquidity contract address is invalid.');
  return value.toLowerCase();
};

const bytes32 = (value: string, label: string): string => {
  if (!BYTES32.test(value)) throw new Error(`${label} must be bytes32.`);
  return value.toLowerCase();
};

const validateSource = (source: DexLiquiditySource): DexLiquiditySource => {
  if (!source.sourceId.trim() || source.sourceId.length > 240) {
    throw new Error('DEX liquidity source identity is invalid.');
  }
  if (source.kind !== 'pool' && source.kind !== 'limit' && source.kind !== 'recurring') {
    throw new Error('DEX liquidity source kind is invalid.');
  }
  if (source.finality !== 'finalized' && source.finality !== 'pending') {
    throw new Error('DEX liquidity source finality is invalid.');
  }
  const chainId = uint(source.chainId, 'DEX liquidity chain ID');
  if (chainId === 0n) throw new Error('DEX liquidity chain must be positive.');
  let publicMarginalPriceE18: string | null = null;
  if (source.kind === 'pool') {
    if (source.publicMarginalPriceE18 === null) {
      throw new Error('DEX Pool marginal price is required.');
    }
    const price = uint(source.publicMarginalPriceE18, 'DEX Pool marginal price');
    if (price === 0n) throw new Error('DEX Pool marginal price must be positive.');
    publicMarginalPriceE18 = price.toString();
  } else if (source.publicMarginalPriceE18 !== null) {
    throw new Error('DEX Limit and Recurring prices must remain private.');
  }
  return Object.freeze({
    ...source,
    chainId: chainId.toString(),
    contractAddress: address(source.contractAddress),
    pairKey: bytes32(source.pairKey, 'DEX liquidity pair key'),
    publicMarginalPriceE18
  });
};

export const buildDexLiquidityPlan = ({
  chainId,
  pairKey,
  direction,
  sources,
  loading = false,
  verificationError = false
}: BuildDexLiquidityPlanInput): DexLiquidityPlan => {
  const expectedChainId = uint(chainId, 'DEX chain ID');
  if (expectedChainId === 0n) throw new Error('DEX chain ID must be positive.');
  const expectedPairKey = bytes32(pairKey, 'DEX pair key');
  const seen = new Set<string>();
  const normalized = sources.map(validateSource).filter((source) => {
    const identity = `${source.chainId}:${source.contractAddress}:${source.sourceId}`;
    if (seen.has(identity)) throw new Error(`Duplicate DEX liquidity source ${identity}.`);
    seen.add(identity);
    return source.chainId === expectedChainId.toString() && source.pairKey === expectedPairKey;
  });
  const pendingSourceCount = normalized.filter((source) => source.finality === 'pending').length;
  const canonicalSources = normalized.filter(
    (source) => source.finality === 'finalized' && source.active
  );
  const sourceCounts: Record<DexLiquidityKind, number> = { pool: 0, limit: 0, recurring: 0 };
  for (const source of canonicalSources) sourceCounts[source.kind]++;
  if (sourceCounts.pool > 1) throw new Error('DEX pair has more than one aggregate Pool source.');
  const publicPoolSource = canonicalSources.find((source) => source.kind === 'pool') ?? null;
  const availability: DexLiquidityAvailability = verificationError
    ? 'error'
    : loading || (canonicalSources.length === 0 && pendingSourceCount > 0)
      ? 'loading'
      : canonicalSources.length > 0
        ? 'available'
        : 'empty';
  return Object.freeze({
    chainId: expectedChainId.toString(),
    pairKey: expectedPairKey,
    direction,
    availability,
    canonicalSources: Object.freeze(canonicalSources),
    pendingSourceCount,
    sourceCounts: Object.freeze(sourceCounts),
    hiddenSourceCount: sourceCounts.limit + sourceCounts.recurring,
    publicPoolSource,
    settlementPolicy: 'price-ordered-multi-source',
    routingPolicy: 'onchain-private-price-gc'
  });
};
