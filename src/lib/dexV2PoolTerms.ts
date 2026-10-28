import { parseDexV2TokenAmountToLots } from './dexV2Terms';

export const DEX_V2_INITIAL_POOL_BASE_WEIGHT_LOTS = 3_988n;
export const DEX_V2_INITIAL_POOL_QUOTE_WEIGHT_LOTS = 21_934n;
export const DEX_V2_MAX_FILL_QUANTA = 63n;

export type DexV2PoolDepositQuote = Readonly<{
  baseMaximumLots: bigint;
  quoteMaximumLots: bigint;
  initialSeedUnits: bigint | null;
}>;

export const quoteDexV2PoolDeposit = ({
  baseAmount,
  quoteAmount,
  baseDecimals,
  quoteDecimals,
  baseLotSize,
  quoteLotSize,
  maximumAggregateLots,
  poolEmpty
}: {
  baseAmount: string;
  quoteAmount: string;
  baseDecimals: number;
  quoteDecimals: number;
  baseLotSize: bigint;
  quoteLotSize: bigint;
  maximumAggregateLots: bigint;
  poolEmpty: boolean;
}): DexV2PoolDepositQuote => {
  const baseMaximumLots = parseDexV2TokenAmountToLots(baseAmount, baseDecimals, baseLotSize);
  const quoteMaximumLots = parseDexV2TokenAmountToLots(quoteAmount, quoteDecimals, quoteLotSize);
  if (baseMaximumLots > maximumAggregateLots || quoteMaximumLots > maximumAggregateLots) {
    throw new Error('Pool maximum exceeds this pair’s reviewed aggregate-lot ceiling.');
  }
  let initialSeedUnits: bigint | null = null;
  if (poolEmpty) {
    if (
      baseMaximumLots % DEX_V2_INITIAL_POOL_BASE_WEIGHT_LOTS !== 0n ||
      quoteMaximumLots % DEX_V2_INITIAL_POOL_QUOTE_WEIGHT_LOTS !== 0n
    ) {
      throw new Error('An empty Pool must be seeded in exact canonical depth units.');
    }
    const baseUnits = baseMaximumLots / DEX_V2_INITIAL_POOL_BASE_WEIGHT_LOTS;
    const quoteUnits = quoteMaximumLots / DEX_V2_INITIAL_POOL_QUOTE_WEIGHT_LOTS;
    if (baseUnits !== quoteUnits || baseUnits < 1n || baseUnits > DEX_V2_MAX_FILL_QUANTA) {
      throw new Error('An empty Pool requires 1 to 63 matching canonical depth units.');
    }
    initialSeedUnits = baseUnits;
  }
  return Object.freeze({ baseMaximumLots, quoteMaximumLots, initialSeedUnits });
};
