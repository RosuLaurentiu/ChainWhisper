const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const HASH = /^0x[0-9a-fA-F]{64}$/;
const ZERO_ADDRESS = `0x${'0'.repeat(40)}`;
const ZERO_HASH = `0x${'0'.repeat(64)}`;
const UINT64_MAX = (1n << 64n) - 1n;
const EXPECTED_CHAIN_ID = '7082400';
const EXPECTED_STRATEGY_OWNER = '0x5dfcee20b5a3fdd3577436a32f62d4c0b39e979d';
const EXPECTED_COUNTS = Object.freeze({ tokens: 4, pairs: 6, strategies: 7 });
const EXPECTED_PRIVATE_BOOK_WORK_PROFILE = Object.freeze({
  inputLatticeCells: 8,
  maximumInputLots: '7',
  semanticId: '0xebba94e30af59ae06a74e9ac84f84e9836a1a78f101f32d8b38b438fe3df50da'
});
const EXPECTED_GRAPH_ROLES = Object.freeze({
  'global-core': 'ChainWhisperUnifiedInventoryGlobalLifecycleCoreV0',
  'position-nft': 'ChainWhisperUnifiedInventoryPositionNFTV0',
  'work-authority': 'ChainWhisperUnifiedInventoryGlobalPrivateBookWorkAuthorityV0'
});
const EXPECTED_PAIR_GRAPH_ROLES = Object.freeze({
  coordinator: 'ChainWhisperUnifiedInventoryPrivateBookL8EconomicCoordinatorV0',
  epoch: 'ChainWhisperUnifiedInventoryPrivateBookL8EpochCoreV0'
});
const SUCCESSOR_DEX_ADMISSION_FAMILIES = Object.freeze([
  'Aggregate',
  'Fixed',
  'Range',
  'Recurring'
] as const);
const EXPECTED_ADMISSION_FAMILY_ROLES = Object.freeze({
  Aggregate: Object.freeze({
    adapter: 'ChainWhisperUnifiedInventoryPrivateBookAggregateAdapterV0',
    capacityModel: 'multi-position-count'
  }),
  Fixed: Object.freeze({
    adapter: 'ChainWhisperUnifiedInventoryPrivateBookFixedAdapterV0',
    capacityModel: 'reusable-single-active-slot'
  }),
  Range: Object.freeze({
    adapter: 'ChainWhisperUnifiedInventoryPrivateBookRangeAdapterV0',
    capacityModel: 'reusable-single-active-slot'
  }),
  Recurring: Object.freeze({
    adapter: 'ChainWhisperUnifiedInventoryPrivateBookRecurringAdapterV0',
    capacityModel: 'reusable-single-active-slot'
  })
} as const);
const EXPECTED_ADMISSION_BRIDGE_ROLE =
  'ChainWhisperUnifiedInventoryPrivateBookL8FamilyBridgeV0';

type RecordValue = Record<string, unknown>;

export type SuccessorDexContract = Readonly<{
  address: string;
  contractName: string;
  deploymentBlock: number;
  deploymentTxHash: string;
  runtimeHash: string;
  semanticId: string | null;
}>;

export type SuccessorDexToken = Readonly<{
  address: string;
  decimals: 6;
  faucetAmountRaw: string;
  faucetMethod: 'claimFaucet()';
  lotSizeRaw: string;
  name: string;
  runtimeHash: string;
  symbol: string;
}>;

export type SuccessorDexPrivateBookWorkProfile = Readonly<{
  inputLatticeCells: number;
  maximumInputLots: string;
  semanticId: string;
}>;

export type SuccessorDexAdmissionFamily =
  typeof SUCCESSOR_DEX_ADMISSION_FAMILIES[number];
export type SuccessorDexAdmissionCapacityModel =
  | 'multi-position-count'
  | 'reusable-single-active-slot';
export type SuccessorDexAdmissionAdapter = Readonly<{
  adapterRoleKey: string;
  bridgeRoleKey: string;
  capacityModel: SuccessorDexAdmissionCapacityModel;
  sourceId: number;
}>;

export type SuccessorDexPair = Readonly<{
  admissionAdapters: Readonly<Partial<
    Record<SuccessorDexAdmissionFamily, SuccessorDexAdmissionAdapter>
  >>;
  coordinator: string | null;
  displayPair: string;
  epochController: string | null;
  marketKey: string;
  readiness: string;
  seedProfile: string;
  sourceCount: number;
  strategies: readonly string[];
  token0: string;
  token1: string;
}>;

export type SuccessorDexStrategy = Readonly<{
  family: string;
  marketKey: string;
  owner: string;
  pair: readonly [string, string];
  positionId: string;
  transactionHash: string;
  blockNumber: number;
  ownershipRevision: string;
}>;

export type SuccessorDexManifest = Readonly<{
  appReady: true;
  buildHash: string;
  chainId: typeof EXPECTED_CHAIN_ID;
  contracts: Readonly<Record<string, SuccessorDexContract>>;
  c1CycleCount: 2;
  deploymentBlockRange: readonly [number, number];
  globalCore: string;
  manifestRevision: string;
  network: 'cotiTestnet';
  p2RouteCount: 6;
  p2SuccessfulRouteLiquiditySupported: false;
  pairs: readonly SuccessorDexPair[];
  positionNFT: string;
  privateBookWorkProfile: SuccessorDexPrivateBookWorkProfile;
  releaseIdentityHash: string;
  status: 'deployed-seeded-app-ready';
  strategies: readonly SuccessorDexStrategy[];
  strategyOwner: string;
  tokens: readonly SuccessorDexToken[];
}>;

export type SuccessorDexDeploymentConfig =
  | Readonly<{ status: 'inactive' }>
  | Readonly<{ status: 'invalid' }>
  | Readonly<{
      status: 'active';
      expectedReleaseIdentityHash: string;
      finalityLagBlocks: number;
      manifestUrl: string;
    }>;

const isRecord = (value: unknown): value is RecordValue =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const text = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is invalid.`);
  return value.trim();
};

const address = (value: unknown, label: string): string => {
  const parsed = text(value, label);
  if (!ADDRESS.test(parsed) || parsed.toLowerCase() === ZERO_ADDRESS) {
    throw new Error(`${label} is invalid.`);
  }
  return parsed;
};

const hash = (value: unknown, label: string): string => {
  const parsed = text(value, label).toLowerCase();
  if (!HASH.test(parsed)) throw new Error(`${label} is invalid.`);
  return parsed;
};

const integer = (value: unknown, label: string): number => {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error(`${label} is invalid.`);
  return Number(value);
};

const decimal = (value: unknown, label: string): string => {
  const parsed = text(value, label);
  if (!/^(0|[1-9][0-9]*)$/.test(parsed)) throw new Error(`${label} is invalid.`);
  return parsed;
};

const parseContracts = (value: unknown): Readonly<Record<string, SuccessorDexContract>> => {
  if (!isRecord(value) || Object.keys(value).length === 0) {
    throw new Error('Successor DEX contract graph is incomplete.');
  }
  const contracts = Object.fromEntries(Object.entries(value).map(([key, candidate]) => {
    if (!key || !isRecord(candidate)) throw new Error('Successor DEX contract entry is invalid.');
    return [key, Object.freeze({
      address: address(candidate.address, `${key} address`),
      contractName: text(candidate.contractName, `${key} contract name`),
      deploymentBlock: integer(candidate.deploymentBlock, `${key} deployment block`),
      deploymentTxHash: hash(candidate.deploymentTxHash, `${key} deployment transaction`),
      runtimeHash: hash(candidate.runtimeHash, `${key} runtime hash`),
      semanticId: candidate.semanticId === undefined || candidate.semanticId === null
        ? null
        : hash(candidate.semanticId, `${key} semantic ID`)
    })];
  }));
  if (new Set(Object.values(contracts).map(({ address: item }) => item.toLowerCase())).size !== Object.keys(contracts).length) {
    throw new Error('Successor DEX contract addresses are not unique.');
  }
  return Object.freeze(contracts);
};

const requireGraphRole = (
  contracts: Readonly<Record<string, SuccessorDexContract>>,
  key: string,
  contractName: string,
  expectedAddress?: string
): SuccessorDexContract => {
  const entry = contracts[key];
  if (!entry || entry.contractName !== contractName ||
      (expectedAddress !== undefined && entry.address.toLowerCase() !== expectedAddress.toLowerCase())) {
    throw new Error(`${key} does not match the corrected successor graph role.`);
  }
  return entry;
};

const parseAdmissionFamily = (
  strategy: string,
  label: string
): SuccessorDexAdmissionFamily => {
  const family = strategy.replace('Tiny', '');
  if (!SUCCESSOR_DEX_ADMISSION_FAMILIES.includes(family as SuccessorDexAdmissionFamily)) {
    throw new Error(`${label} has an unsupported admission family.`);
  }
  return family as SuccessorDexAdmissionFamily;
};

const parseAdmissionAdapters = ({
  contracts,
  displayPair,
  graphLabel,
  sourceCount,
  strategies,
  value
}: {
  contracts: Readonly<Record<string, SuccessorDexContract>>;
  displayPair: string;
  graphLabel: string;
  sourceCount: number;
  strategies: readonly string[];
  value: unknown;
}): Readonly<Partial<Record<SuccessorDexAdmissionFamily, SuccessorDexAdmissionAdapter>>> => {
  if (!isRecord(value)) {
    throw new Error(`${displayPair} admission adapters are missing.`);
  }
  const expected = strategies.map((strategy, index) => {
    const family = parseAdmissionFamily(strategy, displayPair);
    const suffix = strategy === 'AggregateTiny' ? 'aggregate-tiny' : family.toLowerCase();
    return Object.freeze({
      family,
      sourceId: index + 1,
      adapterRoleKey: `spb-${graphLabel}-${suffix}-adapter`,
      bridgeRoleKey: `spb-${graphLabel}-${suffix}-bridge`
    });
  });
  if (expected.length !== sourceCount ||
      new Set(expected.map(({ family }) => family)).size !== expected.length ||
      Object.keys(value).length !== expected.length) {
    throw new Error(`${displayPair} admission adapter count is invalid.`);
  }
  const parsed: Partial<Record<SuccessorDexAdmissionFamily, SuccessorDexAdmissionAdapter>> = {};
  for (const item of expected) {
    const candidate = value[item.family];
    if (!isRecord(candidate)) {
      throw new Error(`${displayPair} ${item.family} admission adapter is missing.`);
    }
    const role = EXPECTED_ADMISSION_FAMILY_ROLES[item.family];
    const adapterRoleKey = text(candidate.adapterRoleKey, `${displayPair} ${item.family} adapter role`);
    const bridgeRoleKey = text(candidate.bridgeRoleKey, `${displayPair} ${item.family} bridge role`);
    const sourceId = integer(candidate.sourceId, `${displayPair} ${item.family} source ID`);
    const capacityModel = text(
      candidate.capacityModel,
      `${displayPair} ${item.family} capacity model`
    );
    if (adapterRoleKey !== item.adapterRoleKey ||
        bridgeRoleKey !== item.bridgeRoleKey ||
        sourceId !== item.sourceId ||
        capacityModel !== role.capacityModel) {
      throw new Error(`${displayPair} ${item.family} admission binding is invalid.`);
    }
    requireGraphRole(contracts, adapterRoleKey, role.adapter);
    requireGraphRole(contracts, bridgeRoleKey, EXPECTED_ADMISSION_BRIDGE_ROLE);
    parsed[item.family] = Object.freeze({
      adapterRoleKey,
      bridgeRoleKey,
      capacityModel,
      sourceId
    } as SuccessorDexAdmissionAdapter);
  }
  return Object.freeze(parsed);
};

const parseTokens = (
  value: unknown,
  contracts: Readonly<Record<string, SuccessorDexContract>>,
  privateRuntimeHash: string
): readonly SuccessorDexToken[] => {
  if (!Array.isArray(value) || value.length !== EXPECTED_COUNTS.tokens) {
    throw new Error('Successor DEX must contain exactly four test tokens.');
  }
  const tokens = value.map((candidate, index): SuccessorDexToken => {
    if (!isRecord(candidate)) throw new Error('Successor DEX token entry is invalid.');
    const symbol = text(candidate.symbol, 'Successor DEX token symbol');
    const parsed = Object.freeze({
      address: address(candidate.address, `${symbol} address`),
      decimals: integer(candidate.decimals, `${symbol} decimals`) as 6,
      faucetAmountRaw: decimal(candidate.faucetAmountRaw, `${symbol} faucet amount`),
      faucetMethod: text(candidate.faucetMethod, `${symbol} faucet method`) as 'claimFaucet()',
      lotSizeRaw: decimal(candidate.lotSizeRaw, `${symbol} lot size`),
      name: text(candidate.name, `${symbol} name`),
      runtimeHash: hash(candidate.runtimeHash, `${symbol} runtime hash`),
      symbol
    });
    const contract = contracts[`token-${symbol.toLowerCase()}`];
    const lotSizeRaw = BigInt(parsed.lotSizeRaw);
    if (parsed.decimals !== 6 || parsed.faucetMethod !== 'claimFaucet()' || lotSizeRaw === 0n ||
        lotSizeRaw > UINT64_MAX ||
        parsed.runtimeHash !== privateRuntimeHash || !contract ||
        contract.address.toLowerCase() !== parsed.address.toLowerCase() ||
        contract.runtimeHash !== parsed.runtimeHash || index > 3) {
      throw new Error(`${symbol} does not match the reviewed private test-token deployment.`);
    }
    return parsed;
  });
  if (new Set(tokens.map(({ symbol }) => symbol)).size !== EXPECTED_COUNTS.tokens ||
      new Set(tokens.map(({ address: item }) => item.toLowerCase())).size !== EXPECTED_COUNTS.tokens) {
    throw new Error('Successor DEX test tokens are not unique.');
  }
  return Object.freeze(tokens);
};

const parsePrivateBookWorkProfile = (value: unknown): SuccessorDexPrivateBookWorkProfile => {
  if (!isRecord(value)) throw new Error('Successor DEX private-book work profile is missing.');
  const inputLatticeCells = integer(value.inputLatticeCells, 'Private-book input lattice cells');
  const maximumInputLots = decimal(value.maximumInputLots, 'Private-book maximum input lots');
  const semanticId = hash(value.semanticId, 'Private-book work semantic ID');
  if (inputLatticeCells !== EXPECTED_PRIVATE_BOOK_WORK_PROFILE.inputLatticeCells ||
      maximumInputLots !== EXPECTED_PRIVATE_BOOK_WORK_PROFILE.maximumInputLots ||
      semanticId !== EXPECTED_PRIVATE_BOOK_WORK_PROFILE.semanticId ||
      BigInt(inputLatticeCells) !== BigInt(maximumInputLots) + 1n || semanticId === ZERO_HASH) {
    throw new Error('Successor DEX private-book work profile is invalid.');
  }
  return Object.freeze({ inputLatticeCells, maximumInputLots, semanticId });
};

const parsePairs = (
  value: unknown,
  tokens: readonly SuccessorDexToken[],
  contracts: Readonly<Record<string, SuccessorDexContract>>
): readonly SuccessorDexPair[] => {
  if (!Array.isArray(value) || value.length !== EXPECTED_COUNTS.pairs) {
    throw new Error('Successor DEX must contain all six canonical pairs.');
  }
  const symbols = new Set(tokens.map(({ symbol }) => symbol));
  const expectedPairs = new Set(tokens.flatMap((left, index) =>
    tokens.slice(index + 1).map((right) => [left.symbol, right.symbol].sort().join('/'))
  ));
  const pairs = value.map((candidate): SuccessorDexPair => {
    if (!isRecord(candidate) || !Array.isArray(candidate.strategies) ||
        candidate.strategies.some((item) => typeof item !== 'string')) {
      throw new Error('Successor DEX pair entry is invalid.');
    }
    const displayPair = text(candidate.displayPair, 'Successor DEX display pair');
    const pairSymbols = displayPair.split('/');
    if (pairSymbols.length !== 2 || pairSymbols.some((symbol) => !symbols.has(symbol))) {
      throw new Error(`${displayPair} uses an unknown test token.`);
    }
    const sourceCount = integer(candidate.sourceCount, `${displayPair} source count`);
    const strategies = Object.freeze([...candidate.strategies] as string[]);
    const coordinator = candidate.coordinator === null ? null : address(candidate.coordinator, `${displayPair} coordinator`);
    const epochController = candidate.epochController === null
      ? null
      : address(candidate.epochController, `${displayPair} epoch controller`);
    const graphLabel = displayPair.split('/').join('-').toLowerCase();
    const coordinatorKey = `spb-${graphLabel}-coordinator`;
    const epochKey = `spb-${graphLabel}-epoch`;
    const admissionAdapters = parseAdmissionAdapters({
      contracts,
      displayPair,
      graphLabel,
      sourceCount,
      strategies,
      value: candidate.admissionAdapters
    });
    if ((sourceCount === 0) !== (coordinator === null && epochController === null)) {
      throw new Error(`${displayPair} source binding is inconsistent.`);
    }
    if (sourceCount === 0) {
      if (contracts[coordinatorKey] || contracts[epochKey]) {
        throw new Error(`${displayPair} sparse graph binding is invalid.`);
      }
    } else {
      const coordinatorRole = requireGraphRole(
        contracts,
        coordinatorKey,
        EXPECTED_PAIR_GRAPH_ROLES.coordinator,
        coordinator!
      );
      requireGraphRole(contracts, epochKey, EXPECTED_PAIR_GRAPH_ROLES.epoch, epochController!);
      if (hash(candidate.coordinatorSemanticId, `${displayPair} coordinator semantic ID`) !==
          EXPECTED_PRIVATE_BOOK_WORK_PROFILE.semanticId ||
          coordinatorRole.semanticId !== EXPECTED_PRIVATE_BOOK_WORK_PROFILE.semanticId) {
        throw new Error(`${displayPair} coordinator semantic binding is invalid.`);
      }
    }
    return Object.freeze({
      admissionAdapters,
      coordinator,
      displayPair,
      epochController,
      marketKey: hash(candidate.marketKey, `${displayPair} market key`),
      readiness: text(candidate.readiness, `${displayPair} readiness`),
      seedProfile: text(candidate.seedProfile, `${displayPair} seed profile`),
      sourceCount,
      strategies,
      token0: address(candidate.token0, `${displayPair} token0`),
      token1: address(candidate.token1, `${displayPair} token1`)
    });
  });
  const actualPairs = new Set(pairs.map(({ displayPair }) => displayPair.split('/').sort().join('/')));
  if (actualPairs.size !== EXPECTED_COUNTS.pairs ||
      [...expectedPairs].some((pair) => !actualPairs.has(pair))) {
    throw new Error('Successor DEX canonical pair coverage is incomplete.');
  }
  return Object.freeze(pairs);
};

const parseStrategies = (
  value: unknown,
  pairs: readonly SuccessorDexPair[],
  strategyOwner: string
): readonly SuccessorDexStrategy[] => {
  if (!Array.isArray(value) || value.length !== EXPECTED_COUNTS.strategies) {
    throw new Error('Successor DEX strategy seed set is incomplete.');
  }
  const marketKeys = new Set(pairs.map(({ marketKey }) => marketKey));
  const strategies = value.map((candidate): SuccessorDexStrategy => {
    if (!isRecord(candidate) || !Array.isArray(candidate.pair) || candidate.pair.length !== 2 ||
        candidate.pair.some((item) => typeof item !== 'string')) {
      throw new Error('Successor DEX strategy entry is invalid.');
    }
    const marketKey = hash(candidate.marketKey, 'Successor DEX strategy market key');
    const owner = address(candidate.owner, 'Successor DEX strategy owner');
    if (!marketKeys.has(marketKey) || owner.toLowerCase() !== strategyOwner.toLowerCase()) {
      throw new Error('Successor DEX strategy binding is invalid.');
    }
    return Object.freeze({
      family: text(candidate.family, 'Successor DEX strategy family'),
      marketKey,
      owner,
      pair: Object.freeze([String(candidate.pair[0]), String(candidate.pair[1])]) as readonly [string, string],
      positionId: decimal(candidate.positionId, 'Successor DEX position ID'),
      transactionHash: hash(candidate.transactionHash, 'Successor DEX strategy transaction hash'),
      blockNumber: integer(candidate.blockNumber, 'Successor DEX strategy block number'),
      ownershipRevision: decimal(candidate.ownershipRevision, 'Successor DEX strategy ownership revision')
    });
  });
  if (new Set(strategies.map(({ positionId }) => positionId)).size !== EXPECTED_COUNTS.strategies) {
    throw new Error('Successor DEX strategy Position NFT IDs are not unique.');
  }
  return Object.freeze(strategies);
};

export const parseSuccessorDexManifest = (value: unknown): SuccessorDexManifest => {
  if (!isRecord(value) || value.schemaVersion !== 1 ||
      value.status !== 'deployed-seeded-app-ready' || value.appReady !== true ||
      value.network !== 'cotiTestnet' || value.chainId !== EXPECTED_CHAIN_ID ||
      !Array.isArray(value.deploymentBlockRange) || value.deploymentBlockRange.length !== 2 ||
      !isRecord(value.privacy) || value.privacy.publicFieldsExcludeInventoryTermsAllocationsAndParticipantReceipts !== true ||
      !isRecord(value.p2) || value.p2.routeCount !== 6 || value.p2.successfulRouteLiquiditySupported !== false ||
      !isRecord(value.c1) || value.c1.cycleCount !== 2 || !Array.isArray(value.receipts) || value.receipts.length === 0 ||
      !isRecord(value.spend)) {
    throw new Error('Successor DEX deployment manifest is not the reviewed testnet candidate.');
  }
  const actualSpend = BigInt(decimal(value.spend.actualGasSpendWei, 'Successor DEX actual spend'));
  const authorizedSpend = BigInt(decimal(value.spend.authorizedCapWei, 'Successor DEX authorized spend'));
  const receiptHashes = new Set((value.receipts as unknown[]).map((receipt) =>
    isRecord(receipt) && receipt.status === 'MINED'
      ? hash(receipt.transactionHash, 'Successor DEX receipt transaction')
      : ''));
  if (actualSpend > authorizedSpend || receiptHashes.has('') ||
      receiptHashes.size !== value.receipts.length) {
    throw new Error('Successor DEX receipt or spend evidence is invalid.');
  }
  const contracts = parseContracts(value.contracts);
  if (Object.values(contracts).some(({ deploymentTxHash }) =>
    !receiptHashes.has(deploymentTxHash))) {
    throw new Error('Successor DEX contract graph is missing deployment receipt evidence.');
  }
  const globalCore = address(value.globalCore, 'Successor DEX global Core');
  const positionNFT = address(value.positionNFT, 'Successor DEX Position NFT');
  requireGraphRole(contracts, 'global-core', EXPECTED_GRAPH_ROLES['global-core'], globalCore);
  requireGraphRole(contracts, 'position-nft', EXPECTED_GRAPH_ROLES['position-nft'], positionNFT);
  requireGraphRole(contracts, 'work-authority', EXPECTED_GRAPH_ROLES['work-authority']);
  const privateRuntimeHash = hash(value.privacy.privateTokenRuntimeHash, 'Private token runtime hash');
  const tokens = parseTokens(value.tokens, contracts, privateRuntimeHash);
  const pairs = parsePairs(value.pairs, tokens, contracts);
  const privateBookWorkProfile = parsePrivateBookWorkProfile(value.privateBookWorkProfile);
  const strategyOwner = address(value.strategyOwner, 'Successor DEX strategy owner');
  if (strategyOwner.toLowerCase() !== EXPECTED_STRATEGY_OWNER) {
    throw new Error('Successor DEX strategy owner is not the approved test wallet.');
  }
  const deploymentBlockRange = value.deploymentBlockRange.map((item, index) =>
    integer(item, `Successor DEX deployment block ${index}`)
  ) as [number, number];
  if (deploymentBlockRange[0] > deploymentBlockRange[1] ||
      Math.max(...Object.values(contracts).map(({ deploymentBlock }) => deploymentBlock)) > deploymentBlockRange[1]) {
    throw new Error('Successor DEX deployment block range is invalid.');
  }
  return Object.freeze({
    appReady: true,
    buildHash: hash(value.buildHash, 'Successor DEX build hash'),
    chainId: EXPECTED_CHAIN_ID,
    contracts,
    c1CycleCount: 2,
    deploymentBlockRange: Object.freeze(deploymentBlockRange),
    globalCore,
    manifestRevision: text(value.manifestRevision, 'Successor DEX manifest revision'),
    network: 'cotiTestnet',
    p2RouteCount: 6,
    p2SuccessfulRouteLiquiditySupported: false,
    pairs,
    positionNFT,
    privateBookWorkProfile,
    releaseIdentityHash: hash(value.releaseIdentityHash, 'Successor DEX release identity'),
    status: 'deployed-seeded-app-ready',
    strategies: parseStrategies(value.strategies, pairs, strategyOwner),
    strategyOwner,
    tokens
  });
};

export const loadSuccessorDexManifest = async ({
  config = SUCCESSOR_DEX_DEPLOYMENT_CONFIG,
  fetcher = fetch,
  signal
}: {
  config?: SuccessorDexDeploymentConfig;
  fetcher?: typeof fetch;
  signal?: AbortSignal;
} = {}): Promise<SuccessorDexManifest> => {
  if (config.status !== 'active') throw new Error('Successor DEX testnet integration is not active.');
  const response = await fetcher(config.manifestUrl, {
    cache: 'no-store',
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
    signal
  });
  if (!response.ok) throw new Error('Successor DEX manifest request failed.');
  const manifest = parseSuccessorDexManifest(await response.json());
  if (manifest.releaseIdentityHash !== config.expectedReleaseIdentityHash) {
    throw new Error('Successor DEX manifest release identity is stale.');
  }
  return manifest;
};

const readConfig = (): SuccessorDexDeploymentConfig => {
  if (import.meta.env.VITE_CHAINWHISPER_SUCCESSOR_DEX_ENABLED !== 'true') {
    return Object.freeze({ status: 'inactive' });
  }
  const manifestUrl = import.meta.env.VITE_CHAINWHISPER_SUCCESSOR_DEX_MANIFEST_URL?.trim() ?? '';
  const expectedReleaseIdentityHash = import.meta.env.VITE_CHAINWHISPER_SUCCESSOR_DEX_RELEASE_IDENTITY_HASH?.trim().toLowerCase() ?? '';
  const finalityLagBlocks = Number(import.meta.env.VITE_CHAINWHISPER_SUCCESSOR_DEX_FINALITY_LAG_BLOCKS ?? '5');
  if (!manifestUrl.startsWith('/') || !HASH.test(expectedReleaseIdentityHash) ||
      !Number.isSafeInteger(finalityLagBlocks) || finalityLagBlocks < 1 || finalityLagBlocks > 64) {
    return Object.freeze({ status: 'invalid' });
  }
  return Object.freeze({ status: 'active', expectedReleaseIdentityHash, finalityLagBlocks, manifestUrl });
};

export const SUCCESSOR_DEX_DEPLOYMENT_CONFIG = readConfig();
