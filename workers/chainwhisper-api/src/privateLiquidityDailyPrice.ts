import {
  decodeFunctionResult,
  encodeFunctionData,
  getAddress,
  isAddress,
  keccak256,
  parseAbi,
  toHex,
  type Address,
  type Hex
} from 'viem';
import { parsePrivateLiquidityV2ApiManifest } from './privateLiquidityV2';
import type { ContractReader } from './rpc';
import type {
  PrivateLiquidityDailyPriceApiSource,
  PublicPrivateLiquidityDailyPricePage,
  PublicPrivateLiquidityDailyPricePoint
} from './types';

const CHAIN_ID = 7_082_400n;
const CONTRACT_VERSION = 'ChainWhisperPrivateLiquidityDailyPriceStoreV1';
const MAX_PAGE = 366n;
const UINT32_MAX = (1n << 32n) - 1n;
const UINT64_MAX = (1n << 64n) - 1n;
const UINT128_MAX = (1n << 128n) - 1n;
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const ZERO_HASH = `0x${'00'.repeat(32)}`;
const HASH = /^0x[0-9a-fA-F]{64}$/u;
const POSITIVE_DECIMAL = /^[1-9][0-9]*$/u;

const ABI = parseAbi([
  'function contractVersion() view returns (string)',
  'function supportsFeature(bytes32 feature) view returns (bool)',
  'function sourceBook() view returns (address)',
  'function sourceBookRuntimeHash() view returns (bytes32)',
  'function owner() view returns (address)',
  'function recorder() view returns (address)',
  'function dayCount(bytes32 pairKey) view returns (uint256)',
  'function getSnapshots(bytes32 pairKey,uint256 start,uint256 count) view returns ((uint64 day,uint64 capturedAt,uint64 sourceBlockNumber,uint32 sourceLogIndex,uint8 direction,uint64 revision,uint128 priceBaseAmount,uint128 priceQuoteAmount,uint256 swapId,uint256 positionId,bytes32 sourceBlockHash,bytes32 sourceTransactionHash)[])'
]);

const FEATURES = ['DAILY_MARGINAL_PRICE', 'ANALYTICS_ONLY', 'SOURCE_PROVENANCE'] as const;

type Manifest = Readonly<{
  manifestHash: Hex;
  address: Address;
  runtimeBytecodeHash: Hex;
  deploymentBlock: bigint;
  deploymentBlockHash: Hex;
  deploymentTransactionHash: Hex;
  sourceBook: Address;
  sourceBookRuntimeHash: Hex;
  owner: Address;
  recorder: Address;
  attestationBlock: Readonly<{ number: bigint; hash: Hex }>;
}>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const exactKeys = (value: Record<string, unknown>, expected: readonly string[]): boolean => {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
};

const canonicalize = (value: unknown): unknown => Array.isArray(value)
  ? value.map(canonicalize)
  : isRecord(value)
    ? Object.fromEntries(Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)]))
    : value;

const address = (value: unknown, label = 'address'): Address => {
  if (typeof value !== 'string' || !isAddress(value)) throw new Error(`invalid ${label}`);
  const normalized = getAddress(value);
  if (normalized.toLowerCase() === ZERO_ADDRESS) throw new Error(`zero ${label}`);
  return normalized;
};

const hash = (value: unknown, label = 'hash'): Hex => {
  if (typeof value !== 'string' || !HASH.test(value) || value.toLowerCase() === ZERO_HASH) {
    throw new Error(`invalid ${label}`);
  }
  return value.toLowerCase() as Hex;
};

const positive = (value: unknown, label = 'decimal'): bigint => {
  if (typeof value !== 'string' || !POSITIVE_DECIMAL.test(value)) throw new Error(`invalid ${label}`);
  return BigInt(value);
};

const uint = (value: unknown, label: string, maximum = (1n << 256n) - 1n): bigint => {
  try {
    const parsed = BigInt(value as string | number | bigint);
    if (parsed < 0n || parsed > maximum) throw new Error();
    return parsed;
  } catch {
    throw new Error(`invalid ${label}`);
  }
};

const field = (value: unknown, name: string, index: number): unknown => {
  if (!isRecord(value)) return undefined;
  return value[name] ?? value[String(index)];
};

const blockReference = (blockHash: Hex) => ({ blockHash, requireCanonical: true });

const blockAt = async (rpc: ContractReader, number: bigint) => {
  const raw = await rpc.request<unknown>('eth_getBlockByNumber', [toHex(number), false]);
  if (!isRecord(raw)) throw new Error('analytics block unavailable');
  const actual = uint(raw.number, 'analytics block number', UINT64_MAX);
  if (actual !== number) throw new Error('analytics block number mismatch');
  return Object.freeze({
    number: actual,
    hash: hash(raw.hash, 'analytics block hash'),
    timestamp: uint(raw.timestamp, 'analytics block timestamp', UINT64_MAX)
  });
};

const call = async (
  rpc: ContractReader,
  contract: Address,
  functionName: string,
  args: readonly unknown[],
  blockHash: Hex
): Promise<unknown> => {
  const data = encodeFunctionData({ abi: ABI, functionName: functionName as never, args: args as never });
  const result = await rpc.request<Hex>('eth_call', [{ to: contract, data }, blockReference(blockHash)]);
  try {
    return decodeFunctionResult({ abi: ABI, functionName: functionName as never, data: result });
  } catch {
    throw new Error(`malformed analytics ${functionName} result`);
  }
};

const verifyCode = async (
  rpc: ContractReader,
  contract: Address,
  expectedHash: Hex,
  blockHash: Hex
): Promise<void> => {
  const code = await rpc.request<Hex>('eth_getCode', [contract, blockReference(blockHash)]);
  if (code === '0x' || keccak256(code).toLowerCase() !== expectedHash) {
    throw new Error('analytics runtime mismatch');
  }
};

export const parsePrivateLiquidityDailyPriceApiManifest = (
  text: string,
  candidateManifestJson: string
): Manifest => {
  const parsed: unknown = JSON.parse(text);
  if (!isRecord(parsed) || !exactKeys(parsed, [
    'schemaVersion', 'status', 'network', 'analyticsKind', 'contract', 'chainId',
    'address', 'runtimeBytecodeHash', 'deploymentBlock', 'deploymentBlockHash',
    'deploymentTransactionHash', 'sourceBook', 'sourceBookRuntimeHash', 'owner',
    'recorder', 'attestationBlock', 'appActivated', 'manifestHash'
  ])) throw new Error('invalid analytics manifest');
  if (
    parsed.schemaVersion !== 1 ||
    parsed.status !== 'attested-analytics-candidate-not-app-active' ||
    parsed.network !== 'cotiTestnet' ||
    parsed.analyticsKind !== 'private-liquidity-daily-marginal-price-v1' ||
    parsed.contract !== CONTRACT_VERSION ||
    parsed.chainId !== '7082400' ||
    parsed.appActivated !== false ||
    !isRecord(parsed.attestationBlock) ||
    !exactKeys(parsed.attestationBlock, ['number', 'hash'])
  ) throw new Error('invalid analytics manifest identity');
  const candidate = parsePrivateLiquidityV2ApiManifest(candidateManifestJson);
  const sourceBook = address(parsed.sourceBook, 'analytics source Book');
  const sourceBookRuntimeHash = hash(parsed.sourceBookRuntimeHash, 'analytics source Book hash');
  const reviewedBook = candidate.components.privateLiquidityBookV2;
  if (
    sourceBook.toLowerCase() !== reviewedBook.address.toLowerCase() ||
    sourceBookRuntimeHash !== reviewedBook.runtimeBytecodeHash
  ) throw new Error('analytics source Book is not the unified candidate');
  const manifestHash = hash(parsed.manifestHash, 'analytics manifest hash');
  const { manifestHash: _ignored, ...body } = parsed;
  if (keccak256(toHex(JSON.stringify(canonicalize(body)))).toLowerCase() !== manifestHash) {
    throw new Error('invalid analytics manifest hash');
  }
  return Object.freeze({
    manifestHash,
    address: address(parsed.address, 'analytics store'),
    runtimeBytecodeHash: hash(parsed.runtimeBytecodeHash, 'analytics runtime hash'),
    deploymentBlock: positive(parsed.deploymentBlock, 'analytics deployment block'),
    deploymentBlockHash: hash(parsed.deploymentBlockHash, 'analytics deployment block hash'),
    deploymentTransactionHash: hash(parsed.deploymentTransactionHash, 'analytics deployment transaction'),
    sourceBook,
    sourceBookRuntimeHash,
    owner: address(parsed.owner, 'analytics owner'),
    recorder: address(parsed.recorder, 'analytics recorder'),
    attestationBlock: Object.freeze({
      number: positive(parsed.attestationBlock.number, 'analytics attestation block'),
      hash: hash(parsed.attestationBlock.hash, 'analytics attestation block hash')
    })
  });
};

export class ManifestPrivateLiquidityDailyPriceApiSource implements PrivateLiquidityDailyPriceApiSource {
  readonly #manifest: Manifest;
  readonly #rpc: ContractReader;
  readonly #finalityLag: bigint;

  constructor(input: {
    analyticsManifestJson: string;
    candidateManifestJson: string;
    rpc: ContractReader;
    finalityLagBlocks?: bigint;
  }) {
    this.#manifest = parsePrivateLiquidityDailyPriceApiManifest(
      input.analyticsManifestJson,
      input.candidateManifestJson
    );
    this.#rpc = input.rpc;
    this.#finalityLag = input.finalityLagBlocks ?? 2n;
    if (this.#finalityLag < 1n || this.#finalityLag > 4_096n) throw new Error('invalid analytics finality lag');
  }

  async getDailyPrices(input: {
    pairKey: Hex;
    start: number | null;
    limit: number;
  }): Promise<PublicPrivateLiquidityDailyPricePage> {
    const pairKey = hash(input.pairKey, 'analytics pair key');
    const requestedStart = input.start === null ? null : uint(input.start, 'analytics start');
    const requestedLimit = uint(input.limit, 'analytics limit');
    if (requestedLimit === 0n || requestedLimit > MAX_PAGE) throw new Error('analytics page is outside the supported bound');
    if (BigInt(await this.#rpc.request<Hex>('eth_chainId', [])) !== CHAIN_ID) throw new Error('wrong analytics chain');

    const manifest = this.#manifest;
    const latest = BigInt(await this.#rpc.request<Hex>('eth_blockNumber', []));
    if (latest <= this.#finalityLag) throw new Error('analytics safe head unavailable');
    const safe = await blockAt(this.#rpc, latest - this.#finalityLag);
    if (safe.number < manifest.deploymentBlock || safe.number < manifest.attestationBlock.number) {
      throw new Error('analytics deployment is not finalized');
    }
    const [deployment, attestation] = await Promise.all([
      blockAt(this.#rpc, manifest.deploymentBlock),
      blockAt(this.#rpc, manifest.attestationBlock.number)
    ]);
    if (deployment.hash !== manifest.deploymentBlockHash || attestation.hash !== manifest.attestationBlock.hash) {
      throw new Error('analytics manifest anchor is not canonical');
    }
    await Promise.all([
      verifyCode(this.#rpc, manifest.address, manifest.runtimeBytecodeHash, safe.hash),
      verifyCode(this.#rpc, manifest.sourceBook, manifest.sourceBookRuntimeHash, safe.hash)
    ]);
    const receipt = await this.#rpc.request<unknown>('eth_getTransactionReceipt', [manifest.deploymentTransactionHash]);
    if (!isRecord(receipt) ||
      hash(receipt.transactionHash, 'analytics receipt transaction') !== manifest.deploymentTransactionHash ||
      uint(receipt.blockNumber, 'analytics receipt block') !== manifest.deploymentBlock ||
      hash(receipt.blockHash, 'analytics receipt block hash') !== manifest.deploymentBlockHash ||
      uint(receipt.status, 'analytics receipt status') !== 1n ||
      address(receipt.contractAddress, 'analytics receipt contract').toLowerCase() !== manifest.address.toLowerCase()) {
      throw new Error('analytics deployment receipt mismatch');
    }

    const [version, sourceBook, sourceHash, owner, recorder, ...featureResults] = await Promise.all([
      call(this.#rpc, manifest.address, 'contractVersion', [], safe.hash),
      call(this.#rpc, manifest.address, 'sourceBook', [], safe.hash),
      call(this.#rpc, manifest.address, 'sourceBookRuntimeHash', [], safe.hash),
      call(this.#rpc, manifest.address, 'owner', [], safe.hash),
      call(this.#rpc, manifest.address, 'recorder', [], safe.hash),
      ...FEATURES.map((feature) => call(
        this.#rpc,
        manifest.address,
        'supportsFeature',
        [keccak256(toHex(feature))],
        safe.hash
      ))
    ]);
    if (
      version !== CONTRACT_VERSION ||
      address(sourceBook, 'analytics bound Book').toLowerCase() !== manifest.sourceBook.toLowerCase() ||
      hash(sourceHash, 'analytics bound Book hash') !== manifest.sourceBookRuntimeHash ||
      address(owner, 'analytics live owner').toLowerCase() !== manifest.owner.toLowerCase() ||
      address(recorder, 'analytics live recorder').toLowerCase() !== manifest.recorder.toLowerCase() ||
      featureResults.some((value) => value !== true)
    ) throw new Error('incompatible analytics deployment');

    const total = uint(await call(this.#rpc, manifest.address, 'dayCount', [pairKey], safe.hash), 'analytics total count');
    const start = requestedStart ?? (total > requestedLimit ? total - requestedLimit : 0n);
    if (start > total) throw new Error('analytics start exceeds total count');
    const remaining = total - start;
    const count = remaining < requestedLimit ? remaining : requestedLimit;
    const rawPoints = count === 0n
      ? []
      : await call(this.#rpc, manifest.address, 'getSnapshots', [pairKey, start, count], safe.hash);
    if (!Array.isArray(rawPoints) || BigInt(rawPoints.length) !== count) {
      throw new Error('analytics page is incomplete');
    }
    let previousDay = -1n;
    const points = rawPoints.map((raw): PublicPrivateLiquidityDailyPricePoint => {
      const day = uint(field(raw, 'day', 0), 'analytics day', UINT64_MAX);
      const capturedAt = uint(field(raw, 'capturedAt', 1), 'analytics captured time', UINT64_MAX);
      const sourceBlockNumber = uint(field(raw, 'sourceBlockNumber', 2), 'analytics source block', UINT64_MAX);
      const sourceLogIndex = uint(field(raw, 'sourceLogIndex', 3), 'analytics source log index', UINT32_MAX);
      const direction = uint(field(raw, 'direction', 4), 'analytics direction', 1n);
      const revision = uint(field(raw, 'revision', 5), 'analytics revision', UINT64_MAX);
      const baseUnits = uint(field(raw, 'priceBaseAmount', 6), 'analytics price base units', UINT128_MAX);
      const quoteUnits = uint(field(raw, 'priceQuoteAmount', 7), 'analytics price quote units', UINT128_MAX);
      const swapId = uint(field(raw, 'swapId', 8), 'analytics source swap');
      const positionId = uint(field(raw, 'positionId', 9), 'analytics source position');
      if (
        day <= previousDay ||
        capturedAt / 86_400n !== day ||
        day >= safe.timestamp / 86_400n ||
        sourceBlockNumber === 0n ||
        sourceBlockNumber > safe.number ||
        revision === 0n ||
        baseUnits === 0n ||
        quoteUnits === 0n ||
        swapId === 0n ||
        positionId === 0n
      ) throw new Error('analytics snapshot invariant failed');
      previousDay = day;
      return {
        day: day.toString(),
        capturedAt: capturedAt.toString(),
        direction: direction === 0n ? 'base-to-quote' : 'quote-to-base',
        revision: revision.toString(),
        price: {
          baseUnits: baseUnits.toString(),
          quoteUnits: quoteUnits.toString(),
          basis: 'quote_per_base'
        },
        source: {
          blockNumber: sourceBlockNumber.toString(),
          blockHash: hash(field(raw, 'sourceBlockHash', 10), 'analytics source block hash'),
          transactionHash: hash(field(raw, 'sourceTransactionHash', 11), 'analytics source transaction'),
          logIndex: Number(sourceLogIndex),
          swapId: swapId.toString(),
          positionId: positionId.toString()
        }
      };
    });
    const finalSafe = await blockAt(this.#rpc, safe.number);
    if (finalSafe.hash !== safe.hash || BigInt(await this.#rpc.request<Hex>('eth_chainId', [])) !== CHAIN_ID) {
      throw new Error('canonical analytics page changed during read');
    }
    const next = start + count;
    return {
      protocol: CONTRACT_VERSION,
      network: 'COTI Testnet',
      chainId: 7_082_400,
      analyticsManifestHash: manifest.manifestHash,
      storeAddress: manifest.address,
      sourceBook: manifest.sourceBook,
      pairKey,
      atBlock: { number: safe.number.toString(), hash: safe.hash, timestamp: safe.timestamp.toString() },
      totalCount: total.toString(),
      start: start.toString(),
      nextStart: next < total ? next.toString() : null,
      completeRange: true,
      points,
      privacyBoundary: {
        publicFields: ['daily-marginal-price', 'utc-day', 'source-provenance'],
        excluded: ['liquidity-depth', 'inventory', 'traded-amounts', 'volume', 'participants'],
        recorderReplayVerifiedByApi: false
      }
    };
  }
}
