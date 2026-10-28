import {
  decodeFunctionResult,
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  isAddress,
  keccak256,
  parseAbi,
  parseAbiParameters,
  toHex,
  type Address,
  type Hex
} from 'viem';
import type { ContractReader } from './rpc';
import type {
  PrivateLiquidityV2ApiSource,
  PublicPrivateLiquidityPair,
  PublicPrivateLiquidityPosition
} from './types';

const CHAIN_ID = 7_082_400n;
const MAX_PAGE = 100n;
const MAX_DISCOVERED_POSITIONS = 4_096n;
const MAX_ACTIVE_POSITIONS = 8;
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const ZERO_HASH = `0x${'00'.repeat(32)}`;
const DECIMAL = /^[1-9][0-9]*$/u;
const HASH = /^0x[0-9a-fA-F]{64}$/u;

export const TESTNET_CANDIDATE_COMPONENT_CONTRACTS = {
  directChatV2: 'ChainWhisperChatV2',
  groupChatV2: 'ChainWhisperGroupChatV2',
  chatReactionsV1: 'ChatReactionsV1',
  directOtcV2: 'ChainWhisperDirectOTCEscrowV2',
  standardOtcV2: 'ChainWhisperStandardOTCEscrowV2',
  privateOtcV2: 'ChainWhisperPrivateOTCEscrowV2',
  recurringOtcV2: 'ChainWhisperRecurringOTCEscrowV2',
  'private-recurringOtcV2': 'ChainWhisperPrivateRecurringOTCEscrowV2',
  privateLiquidityBookV2: 'ChainWhisperPrivateLiquidityBookV2',
  privateLiquidityHiddenIntentV2: 'ChainWhisperPrivateLiquidityHiddenIntentModuleV2',
  privateLiquidityPositionNftV2: 'ChainWhisperPrivateLiquidityPositionNFTV2',
  publicTestTokenA: 'ChainWhisperTestPublicTokenV1',
  publicTestTokenB: 'ChainWhisperTestPublicTokenV1',
  privateTestTokenA: 'ChainWhisperTestPrivateTokenV1',
  privateTestTokenB: 'ChainWhisperTestPrivateTokenV1'
} as const;
export type TestnetCandidateComponentKey = keyof typeof TESTNET_CANDIDATE_COMPONENT_CONTRACTS;
export type TestnetCandidateManifestComponent = {
  key: TestnetCandidateComponentKey;
  contract: string;
  address: Address;
  runtimeBytecodeHash: Hex;
  deploymentBlock: bigint;
};
export type TestnetCandidateManifest = {
  owner: Address;
  manifestHash: Hex;
  attestationBlock: { number: bigint; hash: Hex };
  components: Record<TestnetCandidateComponentKey, TestnetCandidateManifestComponent>;
};

const ABI = parseAbi([
  'function contractVersion() view returns (string)',
  'function supportsFeature(bytes32 feature) view returns (bool)',
  'function hiddenIntentModule() view returns (address)',
  'function hiddenIntentModuleRuntimeHash() view returns (bytes32)',
  'function positionToken() view returns (address)',
  'function pairKey(address baseToken,address quoteToken) pure returns (bytes32)',
  'function positionCountByPair(bytes32 key) view returns (uint256)',
  'function getPositionIdsByPair(bytes32 key,uint256 offset,uint256 limit) view returns (uint256[] ids,uint256 nextOffset)',
  'function getPositionView(uint256 positionId) view returns (((uint8 status,address baseToken,address quoteToken,(uint256 baseAmount,uint256 quoteAmount) buyTerms,(uint256 baseAmount,uint256 quoteAmount) sellTerms,uint64 createdAt,uint64 revision,bytes32 baseTokenCodeHash,bytes32 quoteTokenCodeHash,address privacyOwner,bool buySideAvailable,bool sellSideAvailable) position,uint256 positionId,address positionOwner,bytes32 pairKey) view_)',
  'function lastActivityBlock(uint256 positionId) view returns (uint256)',
  'function openHiddenIntentCountByPair(bytes32 pairKey) view returns (uint256)',
  'function hiddenIntentCursorByPair(bytes32 pairKey) view returns (uint256)'
]);

const FEATURES = [
  'DIRECT_WALLET_AUTHORITY',
  'PRIVATE_TOKEN_PAIRS_ONLY',
  'PUBLIC_PRICES_PRIVATE_INVENTORY',
  'POSITION_NFTS',
  'HIDDEN_INTENTS',
  'IMMUTABLE_HIDDEN_INTENT_MODULE',
  'CONTRACT_SELECTED_INTENT_QUEUE',
  'COMPLETE_BOUNDED_HIDDEN_ROUTES',
  'NO_APP_WALLET_EXECUTOR'
] as const;

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
const address = (value: unknown): Address => {
  if (typeof value !== 'string' || !isAddress(value)) throw new Error('invalid manifest address');
  const normalized = getAddress(value);
  if (normalized.toLowerCase() === ZERO_ADDRESS) throw new Error('zero manifest address');
  return normalized;
};
const hash = (value: unknown): Hex => {
  if (typeof value !== 'string' || !HASH.test(value) || value.toLowerCase() === ZERO_HASH) {
    throw new Error('invalid manifest hash');
  }
  return value.toLowerCase() as Hex;
};
const uint = (value: unknown): bigint => {
  try {
    const parsed = BigInt(value as string | number | bigint);
    if (parsed < 0n) throw new Error();
    return parsed;
  } catch {
    throw new Error('invalid uint');
  }
};
const positive = (value: unknown): bigint => {
  if (typeof value !== 'string' || !DECIMAL.test(value)) throw new Error('invalid decimal');
  return BigInt(value);
};

export const parsePrivateLiquidityV2ApiManifest = (text: string): TestnetCandidateManifest => {
  const parsed: unknown = JSON.parse(text);
  if (!isRecord(parsed) || !exactKeys(parsed, [
    'schemaVersion', 'status', 'network', 'chainId', 'owner', 'attestationBlock',
    'components', 'relationships', 'manifestHash'
  ])) throw new Error('invalid candidate manifest');
  if (
    parsed.schemaVersion !== 1 ||
    parsed.status !== 'attested-testnet-candidate-not-app-active' ||
    parsed.network !== 'cotiTestnet' ||
    parsed.chainId !== '7082400' ||
    !Array.isArray(parsed.components) ||
    parsed.components.length !== 15 ||
    !isRecord(parsed.attestationBlock) ||
    !exactKeys(parsed.attestationBlock, ['number', 'hash']) ||
    !isRecord(parsed.relationships) ||
    !exactKeys(parsed.relationships, ['chatReactionsV1', 'tokenAdmissionOperations', 'appActivated']) ||
    parsed.relationships.tokenAdmissionOperations !== 16 ||
    parsed.relationships.appActivated !== false
  ) throw new Error('invalid candidate manifest identity');
  const list = parsed.components.map((item): TestnetCandidateManifestComponent => {
    if (!isRecord(item) || !exactKeys(item, [
      'key', 'contract', 'address', 'runtimeBytecodeHash', 'deploymentBlock'
    ]) || typeof item.key !== 'string' || !(item.key in TESTNET_CANDIDATE_COMPONENT_CONTRACTS)) {
      throw new Error('invalid candidate component');
    }
    const key = item.key as TestnetCandidateComponentKey;
    if (item.contract !== TESTNET_CANDIDATE_COMPONENT_CONTRACTS[key]) throw new Error('candidate component spoof');
    return {
      key,
      contract: TESTNET_CANDIDATE_COMPONENT_CONTRACTS[key],
      address: address(item.address),
      runtimeBytecodeHash: hash(item.runtimeBytecodeHash),
      deploymentBlock: positive(item.deploymentBlock)
    };
  });
  if (
    new Set(list.map(({ key }) => key)).size !== 15 ||
    new Set(list.map(({ address: item }) => item.toLowerCase())).size !== 15
  ) throw new Error('duplicate candidate component');
  const components = Object.fromEntries(list.map((item) => [item.key, item])) as Record<
    TestnetCandidateComponentKey,
    TestnetCandidateManifestComponent
  >;
  const reactions = parsed.relationships.chatReactionsV1;
  if (!isRecord(reactions) || !exactKeys(reactions, ['directChatV2', 'groupChatV2']) ||
      address(reactions.directChatV2).toLowerCase() !== components.directChatV2.address.toLowerCase() ||
      address(reactions.groupChatV2).toLowerCase() !== components.groupChatV2.address.toLowerCase()) {
    throw new Error('invalid candidate relationships');
  }
  const manifestHash = hash(parsed.manifestHash);
  const { manifestHash: _ignored, ...body } = parsed;
  if (keccak256(toHex(JSON.stringify(canonicalize(body)))).toLowerCase() !== manifestHash) {
    throw new Error('invalid candidate manifest hash');
  }
  return {
    owner: address(parsed.owner),
    manifestHash,
    attestationBlock: {
      number: positive(parsed.attestationBlock.number),
      hash: hash(parsed.attestationBlock.hash)
    },
    components
  };
};

const field = (value: unknown, name: string, index: number): unknown => {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  return record[name] ?? record[String(index)];
};
const blockReference = (blockHash: Hex) => ({ blockHash, requireCanonical: true });
const blockAt = async (rpc: ContractReader, number: bigint) => {
  const raw = await rpc.request<unknown>('eth_getBlockByNumber', [toHex(number), false]);
  if (!isRecord(raw)) throw new Error('block unavailable');
  return { number: uint(raw.number), hash: hash(raw.hash), timestamp: uint(raw.timestamp) };
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
  return decodeFunctionResult({ abi: ABI, functionName: functionName as never, data: result });
};
const verifyCode = async (
  rpc: ContractReader,
  item: TestnetCandidateManifestComponent,
  blockHash: Hex
): Promise<void> => {
  const code = await rpc.request<Hex>('eth_getCode', [item.address, blockReference(blockHash)]);
  if (code === '0x' || keccak256(code).toLowerCase() !== item.runtimeBytecodeHash.toLowerCase()) {
    throw new Error('runtime mismatch');
  }
};
const terms = (raw: unknown) => {
  const baseAmount = uint(field(raw, 'baseAmount', 0));
  const quoteAmount = uint(field(raw, 'quoteAmount', 1));
  if (baseAmount === 0n || quoteAmount === 0n) throw new Error('invalid public terms');
  return { baseAmount: baseAmount.toString(), quoteAmount: quoteAmount.toString() };
};
const compareTerms = (
  left: { baseAmount: string; quoteAmount: string },
  right: { baseAmount: string; quoteAmount: string }
): number => {
  const a = BigInt(left.quoteAmount) * BigInt(right.baseAmount);
  const b = BigInt(right.quoteAmount) * BigInt(left.baseAmount);
  return a < b ? -1 : a > b ? 1 : 0;
};

export class ManifestPrivateLiquidityV2ApiSource implements PrivateLiquidityV2ApiSource {
  readonly #manifest: TestnetCandidateManifest;
  readonly #rpc: ContractReader;
  readonly #finalityLag: bigint;

  constructor(input: { manifestJson: string; rpc: ContractReader; finalityLagBlocks?: bigint }) {
    this.#manifest = parsePrivateLiquidityV2ApiManifest(input.manifestJson);
    this.#rpc = input.rpc;
    this.#finalityLag = input.finalityLagBlocks ?? 2n;
    if (this.#finalityLag < 1n || this.#finalityLag > 4_096n) throw new Error('invalid finality lag');
  }

  async getPair(): Promise<PublicPrivateLiquidityPair> {
    if (BigInt(await this.#rpc.request<Hex>('eth_chainId', [])) !== CHAIN_ID) throw new Error('wrong chain');
    const { components, attestationBlock } = this.#manifest;
    const book = components.privateLiquidityBookV2;
    const module = components.privateLiquidityHiddenIntentV2;
    const nft = components.privateLiquidityPositionNftV2;
    const tokens = [components.privateTestTokenA, components.privateTestTokenB]
      .sort((left, right) => left.address.toLowerCase().localeCompare(right.address.toLowerCase()));
    const attested = await blockAt(this.#rpc, attestationBlock.number);
    if (attested.hash !== attestationBlock.hash) throw new Error('orphaned attestation');
    await Promise.all([book, module, nft, ...tokens].map((item) => verifyCode(this.#rpc, item, attested.hash)));
    const [version, moduleAddress, moduleHash, nftAddress, ...featureResults] = await Promise.all([
      call(this.#rpc, book.address, 'contractVersion', [], attested.hash),
      call(this.#rpc, book.address, 'hiddenIntentModule', [], attested.hash),
      call(this.#rpc, book.address, 'hiddenIntentModuleRuntimeHash', [], attested.hash),
      call(this.#rpc, book.address, 'positionToken', [], attested.hash),
      ...FEATURES.map((name) => call(this.#rpc, book.address, 'supportsFeature', [keccak256(toHex(name))], attested.hash)),
      call(this.#rpc, book.address, 'supportsFeature', [keccak256(toHex('APP_WALLET_EXECUTOR'))], attested.hash)
    ]);
    const appWallet = featureResults.pop();
    if (version !== 'ChainWhisperPrivateLiquidityBookV2' ||
        address(moduleAddress).toLowerCase() !== module.address.toLowerCase() ||
        hash(moduleHash) !== module.runtimeBytecodeHash ||
        address(nftAddress).toLowerCase() !== nft.address.toLowerCase() ||
        featureResults.some((value) => value !== true) || appWallet !== false) {
      throw new Error('incompatible private liquidity deployment');
    }
    const latest = BigInt(await this.#rpc.request<Hex>('eth_blockNumber', []));
    if (latest < this.#finalityLag) throw new Error('safe head unavailable');
    const safe = await blockAt(this.#rpc, latest - this.#finalityLag);
    await Promise.all([book, module, nft, ...tokens].map((item) => verifyCode(this.#rpc, item, safe.hash)));
    const baseToken = tokens[0]!.address;
    const quoteToken = tokens[1]!.address;
    const pairKey = keccak256(encodeAbiParameters(
      parseAbiParameters('address baseToken,address quoteToken'),
      [baseToken, quoteToken]
    ));
    if (hash(await call(this.#rpc, book.address, 'pairKey', [baseToken, quoteToken], safe.hash)) !== pairKey) {
      throw new Error('pair key mismatch');
    }
    const count = uint(await call(this.#rpc, book.address, 'positionCountByPair', [pairKey], safe.hash));
    if (count > MAX_DISCOVERED_POSITIONS) throw new Error('pair history exceeds bound');
    const ids: bigint[] = [];
    let offset = 0n;
    while (BigInt(ids.length) < count) {
      const raw = await call(this.#rpc, book.address, 'getPositionIdsByPair', [pairKey, offset, MAX_PAGE], safe.hash);
      const page = (field(raw, 'ids', 0) as readonly unknown[] | undefined)?.map(uint) ?? [];
      const nextOffset = uint(field(raw, 'nextOffset', 1));
      if (page.length === 0 || page.some((id) => id === 0n || ids.includes(id))) throw new Error('invalid position page');
      ids.push(...page);
      if (BigInt(ids.length) > count || (BigInt(ids.length) < count && nextOffset === 0n)) {
        throw new Error('incomplete position pages');
      }
      offset = nextOffset;
    }
    const positions = (await Promise.all(ids.map(async (positionId): Promise<PublicPrivateLiquidityPosition | null> => {
      const [raw, lastActivity] = await Promise.all([
        call(this.#rpc, book.address, 'getPositionView', [positionId], safe.hash),
        call(this.#rpc, book.address, 'lastActivityBlock', [positionId], safe.hash)
      ]);
      const outer = isRecord(raw) && 'position' in raw ? raw : field(raw, 'view_', 0);
      const position = field(outer, 'position', 0);
      if (uint(field(outer, 'positionId', 1)) !== positionId || hash(field(outer, 'pairKey', 3)) !== pairKey) {
        throw new Error('position identity mismatch');
      }
      const status = uint(field(position, 'status', 0));
      if (status !== 1n) return null;
      const owner = address(field(outer, 'positionOwner', 2));
      const revision = uint(field(position, 'revision', 6));
      if (revision === 0n || address(field(position, 'privacyOwner', 9)).toLowerCase() !== owner.toLowerCase()) {
        throw new Error('position privacy owner mismatch');
      }
      return {
        positionId: positionId.toString(), owner, revision: revision.toString(),
        createdAt: uint(field(position, 'createdAt', 5)).toString(),
        lastActivityBlock: uint(lastActivity).toString(),
        buyTerms: terms(field(position, 'buyTerms', 3)),
        sellTerms: terms(field(position, 'sellTerms', 4)),
        buySideAvailable: field(position, 'buySideAvailable', 10) === true,
        sellSideAvailable: field(position, 'sellSideAvailable', 11) === true
      };
    }))).filter((item): item is PublicPrivateLiquidityPosition => item !== null);
    if (positions.length > MAX_ACTIVE_POSITIONS) throw new Error('active positions exceed bound');
    const byId = (left: PublicPrivateLiquidityPosition, right: PublicPrivateLiquidityPosition) =>
      BigInt(left.positionId) < BigInt(right.positionId) ? -1 : BigInt(left.positionId) > BigInt(right.positionId) ? 1 : 0;
    const asks = [...positions].sort((left, right) => compareTerms(left.sellTerms, right.sellTerms) || byId(left, right));
    const bids = [...positions].sort((left, right) => -compareTerms(left.buyTerms, right.buyTerms) || byId(left, right));
    const [open, cursor] = await Promise.all([
      call(this.#rpc, book.address, 'openHiddenIntentCountByPair', [pairKey], safe.hash).then(uint),
      call(this.#rpc, book.address, 'hiddenIntentCursorByPair', [pairKey], safe.hash).then(uint)
    ]);
    if ((open === 0n && cursor !== 0n) || (open > 0n && cursor >= open)) throw new Error('invalid queue state');
    const finalBlock = await blockAt(this.#rpc, safe.number);
    if (finalBlock.hash !== safe.hash || BigInt(await this.#rpc.request<Hex>('eth_chainId', [])) !== CHAIN_ID) {
      throw new Error('canonical pair changed during read');
    }
    const route = (items: PublicPrivateLiquidityPosition[]) => ({
      positionIds: items.map(({ positionId }) => positionId),
      expectedRevisions: items.map(({ revision }) => revision)
    });
    return {
      protocol: 'PrivateLiquidityV2', network: 'COTI Testnet', chainId: 7_082_400,
      manifestHash: this.#manifest.manifestHash, contractAddress: book.address, pairKey,
      baseToken, quoteToken,
      atBlock: { number: safe.number.toString(), hash: safe.hash, timestamp: safe.timestamp.toString() },
      complete: true, discoveredPositionCount: ids.length, activeContributorCount: positions.length,
      positions, askRoute: route(asks), bidRoute: route(bids),
      hiddenIntentQueue: { openCount: open.toString(), cursor: cursor.toString() },
      privacyBoundary: {
        inventory: 'not-returned', hiddenIntentTerms: 'not-returned',
        hiddenIntentSelection: 'contract-selected-only'
      }
    };
  }
}
