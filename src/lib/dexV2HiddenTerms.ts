import {
  getDexV2TickQuanta,
  packDexV2LimitTerms,
  packDexV2RecurringInventories,
  parseDexV2TokenAmountToLots,
  type DexV2LimitMakerSide
} from './dexV2Terms';

type PairTerms = Readonly<{
  baseDecimals: number;
  quoteDecimals: number;
  baseLotSize: string;
  quoteLotSize: string;
  maximumAggregateLots: string;
  baseToken: string;
  quoteToken: string;
}>;

export const quoteDexV2LimitPosition = ({
  pair,
  makerSide,
  tickRank,
  minimumFillQuanta,
  inventoryAmount
}: {
  pair: PairTerms;
  makerSide: DexV2LimitMakerSide;
  tickRank: number;
  minimumFillQuanta: bigint;
  inventoryAmount: string;
}) => {
  const sellBase = makerSide === 'sell-base';
  const inventoryLots = parseDexV2TokenAmountToLots(
    inventoryAmount,
    sellBase ? pair.baseDecimals : pair.quoteDecimals,
    BigInt(sellBase ? pair.baseLotSize : pair.quoteLotSize)
  );
  if (inventoryLots > BigInt(pair.maximumAggregateLots)) {
    throw new Error('Limit inventory exceeds the pair aggregate-lot ceiling.');
  }
  packDexV2LimitTerms({ makerSide, tickRank, minimumFillQuanta, inventoryLots });
  const outputQuantum = getDexV2TickQuanta(
    tickRank,
    sellBase ? 'quote-to-base' : 'base-to-quote'
  ).outputLots;
  return Object.freeze({
    inventoryLots,
    inventoryToken: sellBase ? pair.baseToken : pair.quoteToken,
    inventorySymbol: sellBase ? 'pUSDC' as const : 'pUSDT' as const,
    executableQuanta: inventoryLots / outputQuantum
  });
};

export const quoteDexV2RecurringPosition = ({
  pair,
  buyTickRank,
  sellTickRank,
  baseAmount,
  quoteAmount
}: {
  pair: PairTerms;
  buyTickRank: number;
  sellTickRank: number;
  baseAmount: string;
  quoteAmount: string;
}) => {
  const baseInventoryLots = parseDexV2TokenAmountToLots(
    baseAmount,
    pair.baseDecimals,
    BigInt(pair.baseLotSize)
  );
  const quoteInventoryLots = parseDexV2TokenAmountToLots(
    quoteAmount,
    pair.quoteDecimals,
    BigInt(pair.quoteLotSize)
  );
  if (
    baseInventoryLots > BigInt(pair.maximumAggregateLots) ||
    quoteInventoryLots > BigInt(pair.maximumAggregateLots)
  ) {
    throw new Error('Recurring inventory exceeds the pair aggregate-lot ceiling.');
  }
  packDexV2RecurringInventories({
    buyTickRank,
    sellTickRank,
    baseInventoryLots,
    quoteInventoryLots
  });
  return Object.freeze({ baseInventoryLots, quoteInventoryLots });
};
