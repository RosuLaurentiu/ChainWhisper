import {
  encodeAbiParameters,
  formatUnits,
  keccak256,
  parseAbi,
  parseAbiParameters,
  parseUnits,
  type Abi,
  type Address as ViemAddress,
  type Hex
} from 'viem';
import {
  APP_ORIGIN,
  CHAIN_ID_HEX,
  CONTRACTS,
  DEFAULT_CARBON_API_URL,
  PRIVACY_ROUTES,
  PUBLIC_ORDER_CONTRACTS,
  VERIFIED_ASSETS,
  getPublicCounterpart,
  publicAsset,
  resolveVerifiedAssetByContract
} from './registry';
import { RpcContractRevertedError, type ContractReader } from './rpc';
import {
  ApiFault,
  type Address,
  type ApiStatus,
  type ChainWhisperApiSource,
  type MarketReference,
  type OrdersPage,
  type PublicOrder,
  type PublicOrderAsset,
  type SwapQuote,
  type SwapQuoteInput,
  type VerifiedAsset
} from './types';

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const ZERO_HASH = `0x${'0'.repeat(64)}` as Hex;
const CARBON_NATIVE_ADDRESS = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';
const QUOTE_SCAN_LIMIT = 8;
const MAX_PARALLEL_SUBREQUESTS = 6;

const READER_ABI = parseAbi([
  'function getPublicDeskPage(address standardEscrow, address privateEscrow, address recurringEscrow, uint256 offset, uint256 limit, bytes32 pairKey, uint8 accessFilter) view returns ((address contractAddress, uint256 localId, uint8 kind, address maker, address taker, uint8 status, bool isPublic, bool hiddenAmount, bool hasPrivateInventory, uint256 lastActivityBlock)[] items, uint256 nextOffset)'
]);
const REGISTRY_ABI = parseAbi([
  'function getContracts() view returns ((address standardEscrow, address privateEscrow, address directEscrow, address recurringEscrow, address reader, address historyReader))'
]);
const STANDARD_ABI = parseAbi([
  'function getTradeView(uint256 tradeId) view returns (((address maker, address taker, uint8 status, (uint8 assetType, address token, uint256 amount) offerAsset, (uint8 assetType, address token, uint256 amount) requestAsset, uint64 createdAt, uint64 expiresAt) trade, (bool isPublic, bytes32 accessHash, uint256 parentTradeId, uint256 feePaid) metadata, (uint256 remainingOfferAmount, uint256 remainingRequestAmount, uint256 filledOfferAmount, uint256 filledRequestAmount) fillState, (bool partialFillsAllowed, uint16 minPartialFillBps, uint256 minRequestAmount, uint256 maxRequestAmountPerWallet, bool oneFillPerWallet) fillPolicy, uint8 effectiveStatus, uint256 replacementTradeId, uint256 replacesTradeId, uint256 rootTradeId))'
]);
const PRIVATE_ABI = parseAbi([
  'function getTradeView(uint256 tradeId) view returns (((address maker, address taker, uint8 status, (uint8 assetType, address token, uint256 amount) offerAsset, (uint8 assetType, address token, uint256 amount) requestAsset, uint64 createdAt, uint64 expiresAt) trade, (bool isPublic, bytes32 accessHash, uint256 feePaid, bytes32 termsHash, uint8 mode, bool hasMakerRecoveryNote) metadata, (uint256 remainingOfferAmount, uint256 remainingRequestAmount, uint256 filledOfferAmount, uint256 filledRequestAmount) fillState, uint8 effectiveStatus, uint256 replacementTradeId, uint256 replacesTradeId))'
]);
const RECURRING_ABI = parseAbi([
  'function getOrderView(uint256 orderId) view returns (((address maker, address taker, uint8 status, uint8 mode, (uint8 assetType, address token) baseAsset, (uint8 assetType, address token) quoteAsset, (uint256 baseAmount, uint256 quoteAmount) buyTerms, (uint256 baseAmount, uint256 quoteAmount) sellTerms, bool isPublic, bytes32 accessHash, uint64 createdAt, uint32 executionCount, uint256 publicBaseInventory, uint256 publicQuoteInventory) order, bool buySideOpen, bool sellSideOpen, bool hasPrivateBaseInventory, bool hasPrivateQuoteInventory))'
]);

const CORE_CODE_HASHES = new Map<string, Hex>([
  [CONTRACTS.registry.toLowerCase(), '0xae15baa1cec72cc10e7e66887db7074c83e91412a7a835fd12503c5235f46d5b'],
  [CONTRACTS.standardEscrow.toLowerCase(), '0xecf06d3293e8b9997a430279dfbbd5f8851e5ac933e2ef1ed0edf4a11e81e892'],
  [CONTRACTS.privateEscrow.toLowerCase(), '0xad34b4097ff02f8f72c9596c43a3f5fddc8ac939d6ef0911bd6e2433676c79bf'],
  [CONTRACTS.recurringEscrow.toLowerCase(), '0x3ebc1ca2d3bc2cb25af2aa8b0c5cb5e3997f3ece1287c786ad65d807efa0febd'],
  [CONTRACTS.reader.toLowerCase(), '0xd7c523aad5b9b474c330c49e4c6e6cb9a75103ca131a15a4a72270f139ae87d0']
]);

const PRIVACY_ROUTE_CODE_HASHES = new Map<string, Hex>([
  ['coti', '0x463eb643ec8835baac402d3942a679715fab7aceae290955c3745b3e86b4e0c8'],
  ['weth', '0xd9ca5fab2200b12a4d5d21739cfe9a7ab2dacc751ffa831d8ce6cea74a3582fc'],
  ['wbtc', '0x5e8740497533ee6952e10029fd4af3f429a052c3398fd90ed11eba6ce5ea9064'],
  ['usdt', '0x8c0548ef822cb556c09b36f6726cd936973f27574d492cab2a4586981ecc0828'],
  ['usdc-e', '0x8c0548ef822cb556c09b36f6726cd936973f27574d492cab2a4586981ecc0828'],
  ['wada', '0x8c0548ef822cb556c09b36f6726cd936973f27574d492cab2a4586981ecc0828'],
  ['gcoti', '0xd9ca5fab2200b12a4d5d21739cfe9a7ab2dacc751ffa831d8ce6cea74a3582fc'],
  ['wisp', '0xb0d6df57abe9e6cc8dbbde71b555c2321cbd00c3793fbb3b6dd4be704a696b45']
]);

const PRIVATE_TOKEN_CODE_HASHES = new Map<string, Hex>([
  ['p.COTI', '0xa923dc5e0a8fa1cbab5d1d98716d72eba226c25cd537759aaf09c9f77076c75b'],
  ['p.WETH', '0xa923dc5e0a8fa1cbab5d1d98716d72eba226c25cd537759aaf09c9f77076c75b'],
  ['p.WBTC', '0x1f9d4db40ac2e5ac49b5aaa7364a93b1c7d242d1d17a3085c2f3e214ef8b6638'],
  ['p.USDT', '0xcff3fb4e2a341d3fde5b9aa25f39af6548e43700cd1de32ec61c11dd51e3f83d'],
  ['p.USDC.e', '0xcff3fb4e2a341d3fde5b9aa25f39af6548e43700cd1de32ec61c11dd51e3f83d'],
  ['p.wADA', '0xcff3fb4e2a341d3fde5b9aa25f39af6548e43700cd1de32ec61c11dd51e3f83d'],
  ['p.gCOTI', '0xa923dc5e0a8fa1cbab5d1d98716d72eba226c25cd537759aaf09c9f77076c75b'],
  ['p.WISP', '0x239e4cbb7bec396a8de567dd91a63e1896b9a4f1bfd1fa35fdc0f5a629d5af19'],
  ['p.PENGO', '0xfc820a1c44394ef1b2b640051dfb7a8d3ddf0e93d5678e3eb0bd3d9b4d9f4694'],
  ['HOTDOG', '0x44579322bb435fc9848f47f043bc677c2a8c31c5aaa483049388e36113ce1d49']
]);

const privateAssets = VERIFIED_ASSETS.filter((asset) => asset.kind === 'private-erc20');

const requiredEntry = <T>(value: T | undefined, label: string): T => {
  if (!value) throw new Error(`Missing runtime attestation entry: ${label}.`);
  return value;
};

const CODE_HASHES = new Map<string, Hex>([
  ...CORE_CODE_HASHES,
  ...PRIVACY_ROUTES.map((route) => [
    route.bridgeAddress.toLowerCase(),
    requiredEntry(PRIVACY_ROUTE_CODE_HASHES.get(route.id), route.id)
  ] as const),
  ...privateAssets.map((asset) => [
    asset.address!.toLowerCase(),
    requiredEntry(PRIVATE_TOKEN_CODE_HASHES.get(asset.symbol), asset.symbol)
  ] as const)
]);

export const RUNTIME_VERIFICATION_SCOPE = {
  registry: true,
  publicOrderReads: ['standardEscrow', 'privateEscrow', 'recurringEscrow', 'reader'],
  privacyPortalRoutes: PRIVACY_ROUTES.map((route) => route.id),
  privateTokenAssets: privateAssets.map((asset) => asset.symbol),
  excluded: ['directEscrow', 'historyReader', 'publicTokenContracts', 'carbonMarketData']
} as const;

const settleInBatches = async <T>(
  tasks: ReadonlyArray<() => Promise<T>>
): Promise<Array<PromiseSettledResult<T>>> => {
  const results: Array<PromiseSettledResult<T>> = [];
  for (let index = 0; index < tasks.length; index += MAX_PARALLEL_SUBREQUESTS) {
    results.push(...await Promise.allSettled(
      tasks.slice(index, index + MAX_PARALLEL_SUBREQUESTS).map((task) => task())
    ));
  }
  return results;
};

const field = (value: unknown, name: string, index: number): unknown => {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  return record[name] ?? record[String(index)];
};

const asBigInt = (value: unknown): bigint => {
  try {
    return typeof value === 'bigint' ? value : BigInt(String(value ?? 0));
  } catch {
    return 0n;
  }
};

const asAddress = (value: unknown): Address | null => {
  const address = String(value ?? '').trim().toLowerCase();
  return /^0x[a-f0-9]{40}$/u.test(address) ? address as Address : null;
};

const asIso = (value: unknown): string => {
  const seconds = Number(asBigInt(value));
  return Number.isSafeInteger(seconds) && seconds > 0
    ? new Date(seconds * 1_000).toISOString()
    : new Date(0).toISOString();
};

const mapTradeStatus = (value: unknown, expiresAt: unknown, now: number): PublicOrder['status'] => {
  const status = Number(asBigInt(value));
  const expiry = Number(asBigInt(expiresAt));
  if (status === 1 && expiry > 0 && expiry * 1_000 <= now) return 'expired';
  if (status === 1) return 'open';
  if (status === 2) return 'filled';
  if (status === 3) return 'cancelled';
  if (status === 4) return 'declined';
  return 'expired';
};

const mapRecurringStatus = (value: unknown): PublicOrder['status'] => {
  const status = Number(asBigInt(value));
  if (status === 1) return 'open';
  if (status === 2) return 'paused';
  return 'cancelled';
};

const ratio = (
  quoteAtomic: bigint,
  quoteDecimals: number,
  baseAtomic: bigint,
  baseDecimals: number
): string | null => {
  if (quoteAtomic <= 0n || baseAtomic <= 0n) return null;
  const precision = 18;
  const scaled =
    quoteAtomic * 10n ** BigInt(baseDecimals + precision) /
    (baseAtomic * 10n ** BigInt(quoteDecimals));
  const raw = formatUnits(scaled, precision);
  return raw.replace(/(?:\.0+|(\.\d+?)0+)$/u, '$1');
};

const assetFromRaw = (value: unknown): VerifiedAsset | null =>
  resolveVerifiedAssetByContract(
    Number(asBigInt(field(value, 'assetType', 0))),
    String(field(value, 'token', 1) ?? ZERO_ADDRESS)
  );

const handleFor = (contract: Address, localId: bigint): string =>
  `cw_${contract.slice(2).toLowerCase()}_${localId}`;

const encodePublicTradeLink = (localId: bigint): string | null => {
  if (localId <= 0n || localId >= 1n << 48n) return null;
  let remaining = localId;
  let byteLength = 0;
  do {
    byteLength += 1;
    remaining >>= 8n;
  } while (remaining > 0n);
  const bytes = new Uint8Array(2 + byteLength);
  bytes[0] = 0x56;
  bytes[1] = (byteLength - 1) << 1;
  remaining = localId;
  for (let index = bytes.length - 1; index >= 2; index -= 1) {
    bytes[index] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/gu, '');
};

const appUrlFor = (contract: Address, localId: bigint): string | null => {
  if (contract.toLowerCase() === CONTRACTS.recurringEscrow.toLowerCase()) {
    return `${APP_ORIGIN}/otc/order/recurring/${localId}`;
  }
  const code = encodePublicTradeLink(localId);
  if (!code) return null;
  const privateQuery =
    contract.toLowerCase() === CONTRACTS.privateEscrow.toLowerCase()
      ? '?escrow=private'
      : '';
  return `${APP_ORIGIN}/otc/order/link/${code}${privateQuery}`;
};

const identityFor = (contract: Address, localId: bigint) => ({
  escrowContract: contract,
  localId: localId.toString(),
  handle: handleFor(contract, localId)
});

const ceilDiv = (left: bigint, right: bigint): bigint =>
  left <= 0n ? 0n : (left + right - 1n) / right;

const decimalNumber = (value: number): string | null => {
  if (!Number.isFinite(value) || value <= 0) return null;
  const fixed = value.toFixed(18).replace(/0+$/u, '').replace(/\.$/u, '');
  return fixed && fixed !== '0' ? fixed : null;
};

type DeskPage = {
  refs: Array<{ contract: Address; localId: bigint }>;
  nextCursor: bigint;
};

type SourceOptions = {
  rpc: ContractReader;
  fetcher?: typeof fetch;
  carbonApiUrl?: string;
  now?: () => number;
  codeHashes?: ReadonlyMap<string, Hex>;
};

export class LiveApiSource implements ChainWhisperApiSource {
  readonly #rpc: ContractReader;
  readonly #fetcher: typeof fetch;
  readonly #carbonApiUrl: string;
  readonly #now: () => number;
  readonly #codeHashes: ReadonlyMap<string, Hex>;
  #statusCache: { expiresAt: number; value: Promise<ApiStatus> } | null = null;

  constructor(options: SourceOptions) {
    this.#rpc = options.rpc;
    this.#fetcher = options.fetcher ?? fetch;
    const carbonApiUrl = new URL(options.carbonApiUrl ?? DEFAULT_CARBON_API_URL);
    const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(carbonApiUrl.hostname);
    if (carbonApiUrl.protocol !== 'https:' && !(loopback && carbonApiUrl.protocol === 'http:')) {
      throw new Error('Carbon API URL must use HTTPS.');
    }
    this.#carbonApiUrl = carbonApiUrl.toString().replace(/\/+$/u, '');
    this.#now = options.now ?? Date.now;
    this.#codeHashes = options.codeHashes ?? CODE_HASHES;
  }

  async getStatus(): Promise<ApiStatus> {
    const now = this.#now();
    if (this.#statusCache && this.#statusCache.expiresAt > now) {
      return this.#statusCache.value;
    }
    const value = this.#readStatus(now);
    this.#statusCache = { expiresAt: now + 60_000, value };
    return value;
  }

  async #readStatus(now: number): Promise<ApiStatus> {
    const base = {
      service: 'chainwhisper-api' as const,
      apiVersion: 'v1' as const,
      network: { name: 'COTI Mainnet' as const, chainId: 2_632_500 as const },
      verificationScope: RUNTIME_VERIFICATION_SCOPE,
      observedAt: new Date(now).toISOString()
    };
    try {
      const chainId = (await this.#rpc.request<string>('eth_chainId', [])).toLowerCase();
      if (chainId !== CHAIN_ID_HEX) {
        return { ...base, ready: false, runtimeVerified: false, issueCode: 'wrong-network' };
      }
      const registryRaw = await this.#rpc.readContract({
        address: CONTRACTS.registry,
        abi: REGISTRY_ABI,
        functionName: 'getContracts'
      });
      const contracts = field(registryRaw, '0', 0) ?? registryRaw;
      const expected = [
        ['standardEscrow', CONTRACTS.standardEscrow],
        ['privateEscrow', CONTRACTS.privateEscrow],
        ['directEscrow', CONTRACTS.directEscrow],
        ['recurringEscrow', CONTRACTS.recurringEscrow],
        ['reader', CONTRACTS.reader],
        ['historyReader', CONTRACTS.historyReader]
      ] as const;
      const registryMatches = expected.every(([name, address], index) =>
        asAddress(field(contracts, name, index)) === address.toLowerCase()
      );
      const codeChecks = await settleInBatches(
        [...this.#codeHashes.entries()].map(([address, expectedHash]) => async () => {
          const code = await this.#rpc.request<Hex>('eth_getCode', [address, 'latest']);
          return code !== '0x' && keccak256(code) === expectedHash;
        })
      );
      if (codeChecks.some((result) => result.status === 'rejected')) {
        throw new Error('Runtime attestation unavailable.');
      }
      if (
        !registryMatches ||
        codeChecks.some((result) => result.status === 'fulfilled' && !result.value)
      ) {
        return { ...base, ready: false, runtimeVerified: false, issueCode: 'runtime-mismatch' };
      }
      return { ...base, ready: true, runtimeVerified: true, issueCode: null };
    } catch {
      return { ...base, ready: false, runtimeVerified: false, issueCode: 'rpc-unavailable' };
    }
  }

  async #requireRuntime(): Promise<void> {
    const status = await this.getStatus();
    if (!status.ready) {
      throw new ApiFault('upstream_unavailable', 'Verified COTI reads are temporarily unavailable.', 503);
    }
  }

  async #deskPage(cursor: number, limit: number, pairKey: Hex = ZERO_HASH): Promise<DeskPage> {
    const raw = await this.#rpc.readContract({
      address: CONTRACTS.reader,
      abi: READER_ABI,
      functionName: 'getPublicDeskPage',
      args: [
        CONTRACTS.standardEscrow,
        CONTRACTS.privateEscrow,
        CONTRACTS.recurringEscrow,
        BigInt(cursor),
        BigInt(limit),
        pairKey,
        0
      ]
    });
    const items = field(raw, 'items', 0);
    const refs = Array.isArray(items)
      ? items.flatMap((item) => {
          const contract = asAddress(field(item, 'contractAddress', 0));
          const localId = asBigInt(field(item, 'localId', 1));
          return contract && PUBLIC_ORDER_CONTRACTS.has(contract) && localId > 0n
            ? [{ contract, localId }]
            : [];
        })
      : [];
    return {
      refs,
      nextCursor: asBigInt(field(raw, 'nextOffset', 1))
    };
  }

  async listOrders(input: { cursor: number; limit: number }): Promise<OrdersPage> {
    await this.#requireRuntime();
    const page = await this.#deskPage(input.cursor, input.limit);
    const settled = await settleInBatches(
      page.refs.map((ref) => () => this.#readPublicOrder(ref.contract, ref.localId))
    );
    if (settled.some((result) => result.status === 'rejected')) {
      throw new ApiFault('upstream_unavailable', 'Public orders are temporarily unavailable.', 503);
    }
    const items = settled.flatMap((result) =>
      result.status === 'fulfilled' && result.value ? [result.value] : []
    );
    return {
      items,
      nextCursor: page.nextCursor > 0n ? page.nextCursor.toString() : null
    };
  }

  async getOrder(contractInput: string, localId: bigint): Promise<PublicOrder | null> {
    await this.#requireRuntime();
    const contract = PUBLIC_ORDER_CONTRACTS.get(contractInput.trim().toLowerCase());
    if (!contract) {
      throw new ApiFault('unsupported_contract', 'Only verified public-order contracts are supported.', 400);
    }
    try {
      return await this.#readPublicOrder(contract, localId);
    } catch (error) {
      if (error instanceof RpcContractRevertedError) return null;
      throw error;
    }
  }

  async #readPublicOrder(contract: Address, localId: bigint): Promise<PublicOrder | null> {
    const normalized = contract.toLowerCase();
    if (normalized === CONTRACTS.standardEscrow.toLowerCase()) {
      return this.#readStandard(contract, localId);
    }
    if (normalized === CONTRACTS.privateEscrow.toLowerCase()) {
      return this.#readPrivate(contract, localId);
    }
    if (normalized === CONTRACTS.recurringEscrow.toLowerCase()) {
      return this.#readRecurring(contract, localId);
    }
    return null;
  }

  async #readStandard(contract: Address, localId: bigint): Promise<PublicOrder | null> {
    const raw = await this.#rpc.readContract({
      address: contract,
      abi: STANDARD_ABI,
      functionName: 'getTradeView',
      args: [localId]
    });
    const trade = field(raw, 'trade', 0);
    const metadata = field(raw, 'metadata', 1);
    if (field(metadata, 'isPublic', 0) !== true) return null;
    const offerRaw = field(trade, 'offerAsset', 3);
    const requestRaw = field(trade, 'requestAsset', 4);
    const offer = assetFromRaw(offerRaw);
    const request = assetFromRaw(requestRaw);
    const maker = asAddress(field(trade, 'maker', 0));
    if (!offer || !request || !maker) return null;
    const taker = asAddress(field(trade, 'taker', 1));
    const offerAtomic = asBigInt(field(offerRaw, 'amount', 2));
    const requestAtomic = asBigInt(field(requestRaw, 'amount', 2));
    const fillState = field(raw, 'fillState', 2);
    const policy = field(raw, 'fillPolicy', 3);
    const expiresAt = field(trade, 'expiresAt', 6);
    return {
      identity: identityFor(contract, localId),
      kind: 'one-off',
      orderType: { id: 'one-off.public.visible-liquidity', label: 'Public one-off order with visible liquidity' },
      status: mapTradeStatus(field(raw, 'effectiveStatus', 4), expiresAt, this.#now()),
      access: 'public',
      liquidityVisibility: 'visible',
      maker,
      recipient: taker && taker !== ZERO_ADDRESS ? taker : null,
      offerAsset: publicAsset(offer),
      requestAsset: publicAsset(request),
      offerAmount: formatUnits(offerAtomic, offer.decimals),
      requestAmount: formatUnits(requestAtomic, request.decimals),
      remainingOfferAmount: formatUnits(asBigInt(field(fillState, 'remainingOfferAmount', 0)), offer.decimals),
      remainingRequestAmount: formatUnits(asBigInt(field(fillState, 'remainingRequestAmount', 1)), request.decimals),
      price: ratio(requestAtomic, request.decimals, offerAtomic, offer.decimals),
      priceBasis: 'quote_per_base',
      createdAt: asIso(field(trade, 'createdAt', 5)),
      expiresAt: asBigInt(expiresAt) > 0n ? asIso(expiresAt) : null,
      appUrl: appUrlFor(contract, localId),
      fillPolicy: {
        partialFillsAllowed: field(policy, 'partialFillsAllowed', 0) === true,
        minPartialFillBps: Number(asBigInt(field(policy, 'minPartialFillBps', 1))),
        minRequestAmount: formatUnits(asBigInt(field(policy, 'minRequestAmount', 2)), request.decimals),
        maxRequestAmountPerWallet: formatUnits(asBigInt(field(policy, 'maxRequestAmountPerWallet', 3)), request.decimals),
        oneFillPerWallet: field(policy, 'oneFillPerWallet', 4) === true
      }
    };
  }

  async #readPrivate(contract: Address, localId: bigint): Promise<PublicOrder | null> {
    const raw = await this.#rpc.readContract({
      address: contract,
      abi: PRIVATE_ABI,
      functionName: 'getTradeView',
      args: [localId]
    });
    const trade = field(raw, 'trade', 0);
    const metadata = field(raw, 'metadata', 1);
    if (field(metadata, 'isPublic', 0) !== true) return null;
    const offer = assetFromRaw(field(trade, 'offerAsset', 3));
    const request = assetFromRaw(field(trade, 'requestAsset', 4));
    const maker = asAddress(field(trade, 'maker', 0));
    if (!offer || !request || !maker) return null;
    const taker = asAddress(field(trade, 'taker', 1));
    const expiresAt = field(trade, 'expiresAt', 6);
    return {
      identity: identityFor(contract, localId),
      kind: 'one-off',
      orderType: { id: 'one-off.public.private-liquidity', label: 'Public one-off private-liquidity order' },
      status: mapTradeStatus(field(raw, 'effectiveStatus', 3), expiresAt, this.#now()),
      access: 'public',
      liquidityVisibility: 'private',
      maker,
      recipient: taker && taker !== ZERO_ADDRESS ? taker : null,
      offerAsset: publicAsset(offer),
      requestAsset: publicAsset(request),
      offerAmount: null,
      requestAmount: null,
      remainingOfferAmount: null,
      remainingRequestAmount: null,
      price: null,
      priceBasis: 'quote_per_base',
      createdAt: asIso(field(trade, 'createdAt', 5)),
      expiresAt: asBigInt(expiresAt) > 0n ? asIso(expiresAt) : null,
      appUrl: appUrlFor(contract, localId)
    };
  }

  async #readRecurring(contract: Address, localId: bigint): Promise<PublicOrder | null> {
    const raw = await this.#rpc.readContract({
      address: contract,
      abi: RECURRING_ABI,
      functionName: 'getOrderView',
      args: [localId]
    });
    const order = field(raw, 'order', 0);
    if (field(order, 'isPublic', 8) !== true) return null;
    const base = assetFromRaw(field(order, 'baseAsset', 4));
    const quote = assetFromRaw(field(order, 'quoteAsset', 5));
    const maker = asAddress(field(order, 'maker', 0));
    if (!base || !quote || !maker) return null;
    const taker = asAddress(field(order, 'taker', 1));
    const buy = field(order, 'buyTerms', 6);
    const sell = field(order, 'sellTerms', 7);
    const buyBase = asBigInt(field(buy, 'baseAmount', 0));
    const buyQuote = asBigInt(field(buy, 'quoteAmount', 1));
    const sellBase = asBigInt(field(sell, 'baseAmount', 0));
    const sellQuote = asBigInt(field(sell, 'quoteAmount', 1));
    const hidden = Number(asBigInt(field(order, 'mode', 3))) !== 0;
    const privateBase = field(raw, 'hasPrivateBaseInventory', 3) === true;
    const privateQuote = field(raw, 'hasPrivateQuoteInventory', 4) === true;
    const publicBase = formatUnits(asBigInt(field(order, 'publicBaseInventory', 12)), base.decimals);
    const publicQuote = formatUnits(asBigInt(field(order, 'publicQuoteInventory', 13)), quote.decimals);
    return {
      identity: identityFor(contract, localId),
      kind: 'recurring',
      orderType: hidden
        ? { id: 'recurring.public.private-liquidity', label: 'Recurring public-access private-liquidity order' }
        : { id: 'recurring.public.visible-liquidity', label: 'Recurring public-access order with visible liquidity' },
      status: mapRecurringStatus(field(order, 'status', 2)),
      access: 'public',
      liquidityVisibility: hidden ? 'private' : 'visible',
      maker,
      recipient: taker && taker !== ZERO_ADDRESS ? taker : null,
      offerAsset: publicAsset(base),
      requestAsset: publicAsset(quote),
      offerAmount: hidden ? null : publicBase,
      requestAmount: hidden ? null : publicQuote,
      remainingOfferAmount: hidden ? null : publicBase,
      remainingRequestAmount: hidden ? null : publicQuote,
      price: null,
      priceBasis: 'quote_per_base',
      createdAt: asIso(field(order, 'createdAt', 10)),
      expiresAt: null,
      appUrl: appUrlFor(contract, localId),
      recurring: {
        baseAsset: publicAsset(base),
        quoteAsset: publicAsset(quote),
        buyBaseAmount: buyBase > 0n ? formatUnits(buyBase, base.decimals) : null,
        buyQuoteAmount: buyQuote > 0n ? formatUnits(buyQuote, quote.decimals) : null,
        sellBaseAmount: sellBase > 0n ? formatUnits(sellBase, base.decimals) : null,
        sellQuoteAmount: sellQuote > 0n ? formatUnits(sellQuote, quote.decimals) : null,
        buyPrice: ratio(buyQuote, quote.decimals, buyBase, base.decimals),
        sellPrice: ratio(sellQuote, quote.decimals, sellBase, base.decimals),
        buyQuoteLiquidity: hidden || privateQuote ? null : publicQuote,
        sellBaseLiquidity: hidden || privateBase ? null : publicBase,
        buySideOpen: field(raw, 'buySideOpen', 1) === true,
        sellSideOpen: field(raw, 'sellSideOpen', 2) === true,
        privateBaseInventory: privateBase,
        privateQuoteInventory: privateQuote
      }
    };
  }

  async getMarketReference(baseAsset: VerifiedAsset, quoteAsset: VerifiedAsset): Promise<MarketReference | null> {
    const base = getPublicCounterpart(baseAsset);
    const quote = getPublicCounterpart(quoteAsset);
    if (!base || !quote || base.id === quote.id) return null;
    const carbonAddress = (asset: VerifiedAsset): string =>
      asset.kind === 'native' ? CARBON_NATIVE_ADDRESS : asset.address!;
    const readUsd = async (asset: VerifiedAsset): Promise<number> => {
      const url = new URL(`${this.#carbonApiUrl}/market-rate`);
      url.searchParams.set('address', carbonAddress(asset));
      url.searchParams.set('convert', 'USD');
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3_000);
      try {
        const response = await this.#fetcher(url, {
          headers: { accept: 'application/json' },
          signal: controller.signal
        });
        const text = await response.text();
        if (!response.ok || text.length > 64_000) throw new Error('market unavailable');
        const payload = JSON.parse(text) as { data?: { USD?: unknown } };
        const value = Number(payload.data?.USD);
        if (!Number.isFinite(value) || value <= 0) throw new Error('market unavailable');
        return value;
      } finally {
        clearTimeout(timeout);
      }
    };
    try {
      const [baseUsd, quoteUsd] = await Promise.all([readUsd(base), readUsd(quote)]);
      const price = decimalNumber(baseUsd / quoteUsd);
      if (!price) return null;
      const usedPublicCounterparts = base.id !== baseAsset.id || quote.id !== quoteAsset.id;
      return {
        source: 'carbon',
        baseAsset: publicAsset(baseAsset),
        quoteAsset: publicAsset(quoteAsset),
        price,
        priceBasis: 'quote_per_base',
        observedAt: new Date(this.#now()).toISOString(),
        executable: false,
        usedPublicCounterparts,
        note: usedPublicCounterparts
          ? 'Reference only. Public-token counterparts were used for private assets.'
          : 'Reference only. Executable liquidity was not checked.'
      };
    } catch {
      return null;
    }
  }

  #pairKey(first: VerifiedAsset, second: VerifiedAsset): Hex {
    const token = (asset: VerifiedAsset): ViemAddress =>
      (asset.address ?? ZERO_ADDRESS) as ViemAddress;
    const assetType = (asset: VerifiedAsset): number =>
      asset.kind === 'native' ? 0 : asset.kind === 'erc20' ? 1 : 2;
    return keccak256(encodeAbiParameters(
      parseAbiParameters('uint8,address,uint8,address'),
      [assetType(first), token(first), assetType(second), token(second)]
    ));
  }

  async quoteBestSingleSwap(input: SwapQuoteInput): Promise<SwapQuote | null> {
    await this.#requireRuntime();
    const [forward, reverse] = await Promise.all([
      this.#deskPage(0, QUOTE_SCAN_LIMIT, this.#pairKey(input.buyAsset, input.sellAsset)),
      this.#deskPage(0, QUOTE_SCAN_LIMIT, this.#pairKey(input.sellAsset, input.buyAsset))
    ]);
    if (forward.nextCursor > 0n || reverse.nextCursor > 0n) {
      throw new ApiFault(
        'quote_scope_too_large',
        'The verified pair has too many public orders for a complete edge quote.',
        409
      );
    }
    const unique = new Map<string, { contract: Address; localId: bigint }>();
    for (const ref of [...forward.refs, ...reverse.refs]) {
      unique.set(`${ref.contract}:${ref.localId}`, ref);
    }
    const settled = await settleInBatches(
      [...unique.values()].map((ref) => () => this.#readPublicOrder(ref.contract, ref.localId))
    );
    if (settled.some((result) => result.status === 'rejected')) {
      throw new ApiFault('upstream_unavailable', 'Public swap quotes are temporarily unavailable.', 503);
    }
    const orders = settled.flatMap((result) =>
      result.status === 'fulfilled' && result.value ? [result.value] : []
    );
    const requested = parseUnits(
      input.amount,
      input.amountMode === 'sell' ? input.sellAsset.decimals : input.buyAsset.decimals
    );
    const candidates: Array<{
      order: PublicOrder;
      sell: bigint;
      buy: bigint;
      recurringSide: 'buy' | 'sell' | null;
    }> = [];
    const add = (
      order: PublicOrder,
      unitSell: bigint,
      unitBuy: bigint,
      availableBuy: bigint,
      recurringSide: 'buy' | 'sell' | null,
      options?: {
        availableSell: bigint;
        originalSell: bigint;
        policy: NonNullable<PublicOrder['fillPolicy']>;
      }
    ) => {
      if (unitSell <= 0n || unitBuy <= 0n || availableBuy <= 0n) return;
      const sell = input.amountMode === 'sell' ? requested : ceilDiv(requested * unitSell, unitBuy);
      const buy = sell * unitBuy / unitSell;
      if (
        sell <= 0n ||
        buy <= 0n ||
        buy > availableBuy ||
        (input.amountMode === 'buy' && buy < requested)
      ) return;
      if (options) {
        if (sell > options.availableSell) return;
        const finalFill = sell === options.availableSell;
        const maxPerWallet = parseUnits(
          options.policy.maxRequestAmountPerWallet,
          order.requestAsset.decimals
        );
        if (maxPerWallet > 0n && sell > maxPerWallet) return;
        if (!finalFill) {
          if (!options.policy.partialFillsAllowed) return;
          const configuredMinimum = parseUnits(
            options.policy.minRequestAmount,
            order.requestAsset.decimals
          );
          const calculatedBpsMinimum =
            options.originalSell *
            BigInt(options.policy.minPartialFillBps) /
            10_000n;
          const bpsMinimum =
            calculatedBpsMinimum > 0n ? calculatedBpsMinimum : 1n;
          if (sell < (configuredMinimum > bpsMinimum ? configuredMinimum : bpsMinimum)) return;
        }
      }
      candidates.push({ order, sell, buy, recurringSide });
    };
    for (const order of orders) {
      if (order.status !== 'open' || order.liquidityVisibility !== 'visible') continue;
      if (
        order.kind === 'one-off' &&
        order.offerAsset.id === input.buyAsset.id &&
        order.requestAsset.id === input.sellAsset.id &&
        order.offerAmount &&
        order.requestAmount &&
        order.remainingOfferAmount &&
        order.remainingRequestAmount &&
        order.fillPolicy
      ) {
        const remainingSell = parseUnits(order.remainingRequestAmount, order.requestAsset.decimals);
        const remainingBuy = parseUnits(order.remainingOfferAmount, order.offerAsset.decimals);
        add(
          order,
          remainingSell,
          remainingBuy,
          remainingBuy,
          null,
          {
            availableSell: remainingSell,
            originalSell: parseUnits(order.requestAmount, order.requestAsset.decimals),
            policy: order.fillPolicy
          }
        );
      }
      const recurring = order.recurring;
      if (!recurring) continue;
      if (
        recurring.baseAsset.id === input.sellAsset.id &&
        recurring.quoteAsset.id === input.buyAsset.id &&
        recurring.buySideOpen &&
        recurring.buyBaseAmount &&
        recurring.buyQuoteAmount &&
        recurring.buyQuoteLiquidity
      ) {
        add(
          order,
          parseUnits(recurring.buyBaseAmount, recurring.baseAsset.decimals),
          parseUnits(recurring.buyQuoteAmount, recurring.quoteAsset.decimals),
          parseUnits(recurring.buyQuoteLiquidity, recurring.quoteAsset.decimals),
          'sell'
        );
      }
      if (
        recurring.quoteAsset.id === input.sellAsset.id &&
        recurring.baseAsset.id === input.buyAsset.id &&
        recurring.sellSideOpen &&
        recurring.sellQuoteAmount &&
        recurring.sellBaseAmount &&
        recurring.sellBaseLiquidity
      ) {
        add(
          order,
          parseUnits(recurring.sellQuoteAmount, recurring.quoteAsset.decimals),
          parseUnits(recurring.sellBaseAmount, recurring.baseAsset.decimals),
          parseUnits(recurring.sellBaseLiquidity, recurring.baseAsset.decimals),
          'buy'
        );
      }
    }
    candidates.sort((left, right) => {
      if (input.amountMode === 'sell' && left.buy !== right.buy) return left.buy > right.buy ? -1 : 1;
      if (input.amountMode === 'buy' && left.sell !== right.sell) return left.sell < right.sell ? -1 : 1;
      return left.order.identity.handle.localeCompare(right.order.identity.handle);
    });
    const best = candidates[0];
    if (!best) return null;
    return {
      source: 'chainwhisper',
      selection: 'best-single-order',
      sellAsset: publicAsset(input.sellAsset),
      buyAsset: publicAsset(input.buyAsset),
      requestedAmount: input.amount,
      amountMode: input.amountMode,
      estimatedSellAmount: formatUnits(best.sell, input.sellAsset.decimals),
      estimatedBuyAmount: formatUnits(best.buy, input.buyAsset.decimals),
      order: best.order.identity,
      orderKind: best.order.kind,
      recurringSide: best.recurringSide,
      appUrl: best.order.appUrl,
      coverage: {
        complete: true,
        visiblePublicLiquidityOnly: true,
        accountEligibilityChecked: false,
        excludes: ['private-liquidity', 'unlisted', 'direct']
      },
      observedAt: new Date(this.#now()).toISOString()
    };
  }
}

export const ABI_FOR_TESTS = {
  reader: READER_ABI as Abi,
  registry: REGISTRY_ABI as Abi,
  standard: STANDARD_ABI as Abi,
  private: PRIVATE_ABI as Abi,
  recurring: RECURRING_ABI as Abi
};
