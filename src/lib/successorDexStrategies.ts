import { Contract, Interface, getAddress, type JsonRpcSigner } from '@coti-io/coti-ethers';
import { ensureTradeTokenAllowance } from './appChain';
import { encryptAuthenticatedUint64Input } from './authenticatedUint64';
import {
  formatDexV2LotsAsTokenAmount,
  parseDexV2TokenAmountToLots,
  scaleDexV2LotsToRaw
} from './dexV2Terms';
import type { SuccessorDexManifest, SuccessorDexPair } from './successorDexDeployment';
import { SUCCESSOR_DEX_GAS_LIMIT } from './successorDexSwap';

const Q = 100_000_000n;
const MAX_LOTS = 1_048_575n;
const FACTOR_SCALE = 1_000_000n;
const ABI = Object.freeze([
  'function admitPosition(address recipient,bytes32 marketKey,(uint256 ciphertext,bytes signature) maximum0,(uint256 ciphertext,bytes signature) maximum1,(uint256 ciphertext,bytes signature) hiddenLaneMode,(uint256 ciphertext,bytes signature) hiddenTarget,(uint256 ciphertext,bytes signature)[7] hiddenPolicy) returns(uint256)',
  'function admitFixedLimit(address recipient,bytes32 marketKey,(uint256 ciphertext,bytes signature) privateTerms,(uint256 ciphertext,bytes signature) fundingTerms) returns(uint256)',
  'function admitRange(address recipient,bytes32 marketKey,(uint256 ciphertext,bytes signature) privateTerms,(uint256 ciphertext,bytes signature) endPriceQ,(uint256 ciphertext,bytes signature) fundingTerms) returns(uint256)',
  'function admitRecurringLl(address recipient,bytes32 marketKey,(uint256 ciphertext,bytes signature)[2] policyTerms,(uint256 ciphertext,bytes signature)[2] minimumOutputs,(uint256 ciphertext,bytes signature)[2] inventories,(uint256 ciphertext,bytes signature)[2] thresholds,(uint256 ciphertext,bytes signature)[2] nextMinimumInventories,(uint256 ciphertext,bytes signature) cooldownActions,(uint256 ciphertext,bytes signature) cycleLimit,(uint256 ciphertext,bytes signature) activeIndex) returns(uint256)',
  'function admitRecurringRr(address recipient,bytes32 marketKey,(uint256 ciphertext,bytes signature)[2] policyTerms,(uint256 ciphertext,bytes signature)[2] endPriceInputs,(uint256 ciphertext,bytes signature)[2] minimumOutputs,(uint256 ciphertext,bytes signature)[2] inventories,(uint256 ciphertext,bytes signature)[2] thresholds,(uint256 ciphertext,bytes signature)[2] nextMinimumInventories,(uint256 ciphertext,bytes signature) cooldownActions,(uint256 ciphertext,bytes signature) cycleLimit,(uint256 ciphertext,bytes signature) activeIndex) returns(uint256)'
] as const);
const RECURRING_HOST = new Interface([
  'function admitRr(uint256 positionId,(uint256 ciphertext,bytes signature)[2] policyTerms,(uint256 ciphertext,bytes signature)[2] endPriceInputs,(uint256 ciphertext,bytes signature)[2] minimumOutputs,(uint256 ciphertext,bytes signature)[2] inventories,(uint256 ciphertext,bytes signature)[2] thresholds,(uint256 ciphertext,bytes signature)[2] nextMinimumInventories,(uint256 ciphertext,bytes signature) cooldownActions,(uint256 ciphertext,bytes signature) cycleLimit,(uint256 ciphertext,bytes signature) activeIndex)'
]);
const NFT = new Interface(['event Transfer(address indexed from,address indexed to,uint256 indexed tokenId)']);

export type SuccessorStrategyRequest =
  | Readonly<{
      family: 'Aggregate';
      pair: SuccessorDexPair;
      amountBySymbol: Readonly<Record<string, string>>;
      startingPrice: number;
      totalSpreadPercent: number;
    }>
  | Readonly<{ family: 'Fixed'; pair: SuccessorDexPair; soldSymbol: string; inventory: string; price: number; minimumOutputPercent: 0 | 25 | 50 | 100 }>
  | Readonly<{ family: 'Range'; pair: SuccessorDexPair; soldSymbol: string; inventory: string; startPrice: number; endPrice: number; minimumOutputPercent: 0 | 25 | 50 | 100 }>
  | Readonly<{ family: 'Recurring'; recurringClass: 'LL'; pair: SuccessorDexPair; baseSymbol: string; quoteSymbol: string; baseInventory: string; quoteInventory: string; buyPrice: number; sellPrice: number }>
  | Readonly<{ family: 'Recurring'; recurringClass: 'RR'; pair: SuccessorDexPair; baseSymbol: string; quoteSymbol: string; baseInventory: string; quoteInventory: string; buyPrice: number; buyEndPrice: number; sellPrice: number; sellEndPrice: number }>;

const token = (manifest: SuccessorDexManifest, symbol: string) => {
  const result = manifest.tokens.find((item) => item.symbol === symbol);
  if (!result) throw new Error(`${symbol} is not in the successor manifest.`);
  return result;
};

const tokenAt = (manifest: SuccessorDexManifest, address: string) => {
  const result = manifest.tokens.find((item) => item.address.toLowerCase() === address.toLowerCase());
  if (!result) throw new Error('The strategy pair token is not in the successor manifest.');
  return result;
};

const lots = (value: bigint, label: string) => {
  if (value < 0n || value > MAX_LOTS) throw new Error(`${label} exceeds the private-lot limit.`);
  return value;
};

const tokenAmountLots = (
  value: string,
  selected: SuccessorDexManifest['tokens'][number],
  label: string,
  allowZero = false
) => {
  if (allowZero && value === '0') return 0n;
  return lots(parseDexV2TokenAmountToLots(value, selected.decimals, BigInt(selected.lotSizeRaw)), label);
};

const ceilDiv = (numerator: bigint, denominator: bigint): bigint =>
  (numerator + denominator - 1n) / denominator;

const ceilSqrt = (value: bigint): bigint => {
  let low = 0n;
  let high = value;
  while (low < high) {
    const middle = (low + high) >> 1n;
    if (middle * middle < value) low = middle + 1n;
    else high = middle;
  }
  return low;
};

const canonicalLotAmounts = (manifest: SuccessorDexManifest, pair: SuccessorDexPair) => {
  const token0 = tokenAt(manifest, pair.token0);
  const token1 = tokenAt(manifest, pair.token1);
  return Object.freeze({
    token0: Number(formatDexV2LotsAsTokenAmount(1n, token0.decimals, BigInt(token0.lotSizeRaw))),
    token1: Number(formatDexV2LotsAsTokenAmount(1n, token1.decimals, BigInt(token1.lotSizeRaw)))
  });
};

export const successorStrategyDisplayedPriceToPriceQ = (manifest: SuccessorDexManifest, pair: SuccessorDexPair, baseSymbol: string, displayedPrice: number): bigint => {
  if (!Number.isFinite(displayedPrice) || displayedPrice <= 0) throw new Error('Strategy price is invalid.');
  const base = token(manifest, baseSymbol).address;
  const canonicalHumanPrice = base.toLowerCase() === pair.token0.toLowerCase() ? displayedPrice : 1 / displayedPrice;
  const lotAmounts = canonicalLotAmounts(manifest, pair);
  const encoded = BigInt(Math.round(canonicalHumanPrice * lotAmounts.token0 / lotAmounts.token1 * Number(Q)));
  if (encoded <= 0n || encoded > 18_446_744_073_709_551_615n) throw new Error('Strategy price exceeds uint64.');
  return encoded;
};

export const successorStrategyPriceQToDisplayedPrice = (
  manifest: SuccessorDexManifest,
  pair: SuccessorDexPair,
  baseSymbol: string,
  priceQ: bigint
): number => {
  if (priceQ <= 0n || priceQ > 18_446_744_073_709_551_615n) throw new Error('Strategy price exceeds uint64.');
  const lotAmounts = canonicalLotAmounts(manifest, pair);
  const canonicalHumanPrice = Number(priceQ) / Number(Q) * lotAmounts.token1 / lotAmounts.token0;
  return token(manifest, baseSymbol).address.toLowerCase() === pair.token0.toLowerCase()
    ? canonicalHumanPrice
    : 1 / canonicalHumanPrice;
};

export const buildAggregatePolicy = ({
  manifest,
  pair,
  amount0,
  amount1,
  startingPrice,
  totalSpreadPercent
}: {
  manifest: SuccessorDexManifest;
  pair: SuccessorDexPair;
  amount0: bigint;
  amount1: bigint;
  startingPrice: number;
  totalSpreadPercent: number;
}) => {
  const baseSymbol = pair.displayPair.split('/')[0];
  const priceQ = successorStrategyDisplayedPriceToPriceQ(manifest, pair, baseSymbol, startingPrice);
  if (!Number.isFinite(totalSpreadPercent) || totalSpreadPercent < 0 || totalSpreadPercent > 20) {
    throw new Error('Aggregate spread must be between 0% and 20%.');
  }
  const totalSpreadPpm = BigInt(Math.round(totalSpreadPercent * 10_000));
  const spreadFactorPpm = ceilSqrt(FACTOR_SCALE * (FACTOR_SCALE + totalSpreadPpm));

  // ponytail: deterministic two-times funded depth; add a private depth control
  // only after price-impact tests justify the extra product setting.
  const normalized0 = amount0 > ceilDiv(amount1 * Q, priceQ)
    ? amount0
    : ceilDiv(amount1 * Q, priceQ);
  const effective0 = normalized0 * 2n;
  const effective1 = ceilDiv(effective0 * priceQ, Q);
  const virtual0 = effective0 - amount0;
  const virtual1 = effective1 - amount1;
  if (
    normalized0 === 0n || virtual0 === 0n || virtual1 === 0n ||
    effective0 > 2_147_483_647n || effective1 > 2_147_483_647n
  ) throw new Error('Aggregate price and budgets exceed the reviewed effective-inventory domain.');

  return Object.freeze({
    laneMode: 1n,
    target: 0n,
    priceQ,
    spreadFactorPpm,
    policy: Object.freeze([
      virtual0,
      virtual1,
      spreadFactorPpm,
      0n,
      MAX_LOTS,
      0n,
      MAX_LOTS
    ] as const)
  });
};

export const createSuccessorStrategy = async ({
  signer,
  manifest,
  request
}: {
  signer: JsonRpcSigner;
  manifest: SuccessorDexManifest;
  request: SuccessorStrategyRequest;
}): Promise<Readonly<{ positionId: string; transactionHash: string }>> => {
  const owner = getAddress(await signer.getAddress());
  const authorityAddress = manifest.contracts['work-authority']?.address;
  if (!authorityAddress) throw new Error('Successor work authority is missing.');
  const authority = new Contract(authorityAddress, ABI, signer);
  const method = request.family === 'Aggregate'
    ? 'admitPosition'
    : request.family === 'Fixed'
      ? 'admitFixedLimit'
      : request.family === 'Range'
        ? 'admitRange'
        : request.recurringClass === 'RR'
          ? 'admitRecurringRr'
          : 'admitRecurringLl';
  const selector = authority.interface.getFunction(method)!.selector;
  const encrypt = (plaintext: bigint) => encryptAuthenticatedUint64Input(signer, { plaintext, contractAddress: authorityAddress, functionSelector: selector });
  const encryptMany = async (values: readonly bigint[]) => {
    const encrypted = [];
    for (const value of values) encrypted.push(await encrypt(value));
    return encrypted;
  };
  const pairSymbols = request.pair.displayPair.split('/');
  let args: unknown[];

  if (request.family === 'Aggregate') {
    const token0 = tokenAt(manifest, request.pair.token0);
    const token1 = tokenAt(manifest, request.pair.token1);
    const maximum0 = tokenAmountLots(request.amountBySymbol[token0.symbol] ?? '0', token0, 'Token0 amount');
    const maximum1 = tokenAmountLots(request.amountBySymbol[token1.symbol] ?? '0', token1, 'Token1 amount');
    if (maximum0 === 0n || maximum1 === 0n) throw new Error('Aggregate Pool requires both token amounts.');
    const aggregatePolicy = buildAggregatePolicy({
      manifest,
      pair: request.pair,
      amount0: maximum0,
      amount1: maximum1,
      startingPrice: request.startingPrice,
      totalSpreadPercent: request.totalSpreadPercent
    });
    await ensureTradeTokenAllowance(signer, owner, request.pair.token0, scaleDexV2LotsToRaw(maximum0, BigInt(token0.lotSizeRaw)), 'private-erc20', manifest.globalCore);
    await ensureTradeTokenAllowance(signer, owner, request.pair.token1, scaleDexV2LotsToRaw(maximum1, BigInt(token1.lotSizeRaw)), 'private-erc20', manifest.globalCore);
    const encrypted = await encryptMany([maximum0, maximum1, aggregatePolicy.laneMode, aggregatePolicy.target, ...aggregatePolicy.policy]);
    args = [owner, request.pair.marketKey, encrypted[0], encrypted[1], encrypted[2], encrypted[3], encrypted.slice(4)];
  } else if (request.family === 'Fixed' || request.family === 'Range') {
    const sold = token(manifest, request.soldSymbol);
    const inventory = tokenAmountLots(request.inventory, sold, `${request.family} inventory`);
    if (inventory === 0n) throw new Error(`${request.family} inventory must be above zero.`);
    const side = sold.address.toLowerCase() === request.pair.token0.toLowerCase() ? 0n : 1n;
    const baseSymbol = pairSymbols[0];
    const startPriceQ = successorStrategyDisplayedPriceToPriceQ(
      manifest,
      request.pair,
      baseSymbol,
      request.family === 'Fixed' ? request.price : request.startPrice
    );
    if (![0, 25, 50, 100].includes(request.minimumOutputPercent)) {
      throw new Error(`${request.family} minimum output is invalid.`);
    }
    const minimumOutput = ceilDiv(inventory * BigInt(request.minimumOutputPercent), 100n);
    if (request.family === 'Fixed') {
      await ensureTradeTokenAllowance(signer, owner, sold.address, scaleDexV2LotsToRaw(inventory, BigInt(sold.lotSizeRaw)), 'private-erc20', manifest.globalCore);
      const [privateTerms, fundingTerms] = await encryptMany([
        startPriceQ * 2n + side,
        (inventory << 20n) + minimumOutput
      ]);
      args = [owner, request.pair.marketKey, privateTerms, fundingTerms];
    } else {
      const endPriceQ = successorStrategyDisplayedPriceToPriceQ(manifest, request.pair, baseSymbol, request.endPrice);
      if ((side === 1n && endPriceQ < startPriceQ) || (side === 0n && endPriceQ > startPriceQ)) {
        throw new Error('Range end price moves in the wrong direction for the funded side.');
      }
      await ensureTradeTokenAllowance(signer, owner, sold.address, scaleDexV2LotsToRaw(inventory, BigInt(sold.lotSizeRaw)), 'private-erc20', manifest.globalCore);
      const [privateTerms, encryptedEndPrice, fundingTerms] = await encryptMany([
        startPriceQ * 2n + side,
        endPriceQ,
        (inventory << 20n) + minimumOutput
      ]);
      args = [owner, request.pair.marketKey, privateTerms, encryptedEndPrice, fundingTerms];
    }
  } else {
    const base = token(manifest, request.baseSymbol);
    const quote = token(manifest, request.quoteSymbol);
    const baseInventory = tokenAmountLots(request.baseInventory, base, 'Recurring base inventory', true);
    const quoteInventory = tokenAmountLots(request.quoteInventory, quote, 'Recurring quote inventory', true);
    if (baseInventory === 0n && quoteInventory === 0n) throw new Error('Recurring inventory must be above zero.');
    const buySide = quote.address.toLowerCase() === request.pair.token0.toLowerCase() ? 0n : 1n;
    const sellSide = base.address.toLowerCase() === request.pair.token0.toLowerCase() ? 0n : 1n;
    const buyQ = successorStrategyDisplayedPriceToPriceQ(manifest, request.pair, request.baseSymbol, request.buyPrice);
    const sellQ = successorStrategyDisplayedPriceToPriceQ(manifest, request.pair, request.baseSymbol, request.sellPrice);
    const inventory0 = base.address.toLowerCase() === request.pair.token0.toLowerCase() ? baseInventory : quoteInventory;
    const inventory1 = base.address.toLowerCase() === request.pair.token1.toLowerCase() ? baseInventory : quoteInventory;
    const activeIndex = quoteInventory > 0n ? 0n : 1n;
    let values: readonly bigint[];
    if (request.recurringClass === 'RR') {
      const buyEndQ = successorStrategyDisplayedPriceToPriceQ(manifest, request.pair, request.baseSymbol, request.buyEndPrice);
      const sellEndQ = successorStrategyDisplayedPriceToPriceQ(manifest, request.pair, request.baseSymbol, request.sellEndPrice);
      if ((buySide === 1n && buyEndQ < buyQ) || (buySide === 0n && buyEndQ > buyQ) ||
          (sellSide === 1n && sellEndQ < sellQ) || (sellSide === 0n && sellEndQ > sellQ)) {
        throw new Error('Recurring Range end price moves in the wrong direction for its funded side.');
      }
      const binding = request.pair.admissionAdapters.Recurring;
      const adapter = binding ? manifest.contracts[binding.adapterRoleKey] : null;
      const hostRoleKey = binding?.adapterRoleKey.replace(/-adapter$/u, '-host');
      const host = hostRoleKey ? manifest.contracts[hostRoleKey] : null;
      if (!binding || !adapter || adapter.contractName !== 'ChainWhisperUnifiedInventoryPrivateBookRecurringAdapterV0' ||
          !host || host.contractName !== 'ChainWhisperUnifiedInventoryRecurringOrderHostV0') {
        throw new Error('Corrected Recurring adapter and host are missing for this pair.');
      }
      const hostSelector = RECURRING_HOST.getFunction('admitRr')!.selector;
      const encryptForHost = (plaintext: bigint) => encryptAuthenticatedUint64Input(signer, {
        plaintext,
        contractAddress: host.address,
        functionSelector: hostSelector
      });
      const encryptManyForHost = async (plaintexts: readonly bigint[]) => {
        const encrypted = [];
        for (const plaintext of plaintexts) encrypted.push(await encryptForHost(plaintext));
        return encrypted;
      };
      values = [
        buyQ * 2n + buySide, sellQ * 2n + sellSide,
        buyEndQ, sellEndQ,
        1n, 1n,
        inventory0, inventory1,
        0n, 0n,
        1n, 1n,
        0n, 0n, activeIndex
      ];
      const encrypted = await encryptManyForHost(values);
      args = [
        owner, request.pair.marketKey,
        encrypted.slice(0, 2), encrypted.slice(2, 4),
        encrypted.slice(4, 6), encrypted.slice(6, 8),
        encrypted.slice(8, 10), encrypted.slice(10, 12),
        encrypted[12], encrypted[13], encrypted[14]
      ];
    } else {
      values = [buyQ * 2n + buySide, sellQ * 2n + sellSide, 1n, 1n, inventory0, inventory1, 0n, 0n, 1n, 1n, 0n, 0n, activeIndex];
      const encrypted = await encryptMany(values);
      args = [owner, request.pair.marketKey, encrypted.slice(0, 2), encrypted.slice(2, 4), encrypted.slice(4, 6), encrypted.slice(6, 8), encrypted.slice(8, 10), encrypted[10], encrypted[11], encrypted[12]];
    }
    if (baseInventory) await ensureTradeTokenAllowance(signer, owner, base.address, scaleDexV2LotsToRaw(baseInventory, BigInt(base.lotSizeRaw)), 'private-erc20', manifest.globalCore);
    if (quoteInventory) await ensureTradeTokenAllowance(signer, owner, quote.address, scaleDexV2LotsToRaw(quoteInventory, BigInt(quote.lotSizeRaw)), 'private-erc20', manifest.globalCore);
  }

  const transaction = await authority.getFunction(method)(...args, { gasLimit: SUCCESSOR_DEX_GAS_LIMIT });
  const receipt = await transaction.wait(1);
  if (!receipt || receipt.status !== 1) throw new Error('Successor strategy admission failed.');
  const transfers = receipt.logs.flatMap((log: { address: string; topics: readonly string[]; data: string }) => {
    if (log.address.toLowerCase() !== manifest.positionNFT.toLowerCase()) return [];
    try {
      const parsed = NFT.parseLog({ topics: [...log.topics], data: log.data });
      return parsed?.name === 'Transfer' && String(parsed.args[1]).toLowerCase() === owner.toLowerCase() ? [BigInt(parsed.args[2])] : [];
    } catch { return []; }
  });
  if (transfers.length !== 1) throw new Error('Position NFT mint was not found in the admission receipt.');
  return Object.freeze({ positionId: transfers[0].toString(), transactionHash: transaction.hash });
};
