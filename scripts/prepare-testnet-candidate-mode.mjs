import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { keccak256, toUtf8Bytes } from '@coti-io/coti-ethers';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CURRENT_PRIVATE_LIQUIDITY = JSON.parse(await readFile(resolve(APP_ROOT, 'src/lib/currentPrivateLiquidityBinding.json'), 'utf8'));
const MANIFEST_PATH = resolve(
  APP_ROOT,
  '..',
  'ChainWhisper Contracts',
  'deployments',
  'coti-testnet-unified-candidate.json'
);
const DAILY_PRICE_MANIFEST_PATH = resolve(APP_ROOT, 'deployments', 'coti-testnet-private-liquidity-daily-price-store.json');
const SUCCESSOR_DEX_MANIFEST_PATH = resolve(
  APP_ROOT,
  '..',
  'ChainWhisper Contracts',
  'deployments',
  'coti-testnet-successor-app-manifest-v3.json'
);
const PUBLIC_SUCCESSOR_DEX_MANIFEST_PATH = resolve(
  APP_ROOT,
  'public',
  'deployments',
  'coti-testnet-successor-app-manifest.json'
);
const OUTPUT_PATH = resolve(APP_ROOT, '.env.coti-testnet-candidate.local');
const BYTES32 = /^0x[0-9a-fA-F]{64}$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const ZERO_ADDRESS = `0x${'00'.repeat(20)}`;
const POSITIVE_DECIMAL = /^[1-9][0-9]*$/;
const DEX_V2_COMPONENT_KEYS = Object.freeze([
  'factory', 'pool', 'limit', 'recurring', 'swap', 'core', 'positionToken'
]);
const SUCCESSOR_L8_SEMANTIC_ID =
  '0xebba94e30af59ae06a74e9ac84f84e9836a1a78f101f32d8b38b438fe3df50da';
const SUCCESSOR_GRAPH_ROLES = Object.freeze({
  'global-core': 'ChainWhisperUnifiedInventoryGlobalLifecycleCoreV0',
  'position-nft': 'ChainWhisperUnifiedInventoryPositionNFTV0',
  'work-authority': 'ChainWhisperUnifiedInventoryGlobalPrivateBookWorkAuthorityV0'
});
const SUCCESSOR_PAIR_GRAPH_ROLES = Object.freeze({
  coordinator: 'ChainWhisperUnifiedInventoryPrivateBookL8EconomicCoordinatorV0',
  epoch: 'ChainWhisperUnifiedInventoryPrivateBookL8EpochCoreV0'
});

const canonicalize = (value) => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)])
    );
  }
  return value;
};

const hasExactManifestHash = (manifest) => {
  const { manifestHash, ...body } = manifest;
  return typeof manifestHash === 'string' && BYTES32.test(manifestHash) &&
    keccak256(toUtf8Bytes(JSON.stringify(canonicalize(body)))).toLowerCase() === manifestHash.toLowerCase();
};

const exactAddressRecord = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).length === keys.length && keys.every((key) =>
    typeof value[key] === 'string' && ADDRESS.test(value[key]) && value[key].toLowerCase() !== ZERO_ADDRESS);

const exactHashRecord = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).length === keys.length && keys.every((key) => BYTES32.test(value[key]));

const exactBlock = (value) => value && typeof value === 'object' && !Array.isArray(value) &&
  typeof value.number === 'string' && POSITIVE_DECIMAL.test(value.number) && BYTES32.test(value.hash);

export const buildDexV2Env = (manifestText, unifiedManifest) => {
  if (manifestText === undefined) return [];
  let manifest;
  try {
    manifest = JSON.parse(manifestText);
  } catch {
    throw new Error('DEX V2 app manifest must be valid JSON.');
  }
  const baseComponent = unifiedManifest.components.find(({ key }) => key === 'privateTestTokenA');
  const quoteComponent = unifiedManifest.components.find(({ key }) => key === 'privateTestTokenB');
  const anchors = manifest?.deploymentAnchors;
  const pair = manifest?.pair;
  const activation = manifest?.activation;
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest) ||
      manifest.schemaVersion !== 1 || manifest.status !== 'activated-testnet' ||
      manifest.network !== 'cotiTestnet' || manifest.chainId !== '7082400' ||
      manifest.productionActivationEvidence !== false || !hasExactManifestHash(manifest) ||
      typeof manifest.operator !== 'string' || !ADDRESS.test(manifest.operator) ||
      manifest.operator.toLowerCase() === ZERO_ADDRESS ||
      typeof manifest.owner !== 'string' || !ADDRESS.test(manifest.owner) ||
      manifest.owner.toLowerCase() === ZERO_ADDRESS ||
      !BYTES32.test(manifest.deploymentPlanHash) || !BYTES32.test(manifest.deploymentCandidateHash) ||
      !BYTES32.test(manifest.activationPlanHash) || !BYTES32.test(manifest.activationReportHash) ||
      !exactAddressRecord(manifest.addresses, DEX_V2_COMPONENT_KEYS) ||
      new Set(Object.values(manifest.addresses).map((value) => value.toLowerCase())).size !== DEX_V2_COMPONENT_KEYS.length ||
      !exactHashRecord(manifest.runtimeHashes, DEX_V2_COMPONENT_KEYS) ||
      !anchors || !exactBlock(anchors.factory) || !exactBlock(anchors.economicSuite) ||
      !exactBlock(anchors.pairRegistration) ||
      !pair || typeof pair.baseToken !== 'string' || !ADDRESS.test(pair.baseToken) ||
      typeof pair.quoteToken !== 'string' || !ADDRESS.test(pair.quoteToken) ||
      !BYTES32.test(pair.pairKey) || !BYTES32.test(pair.baseTokenRuntimeHash) ||
      !BYTES32.test(pair.quoteTokenRuntimeHash) || !BYTES32.test(pair.privateTokenRuntimeManifestHash) ||
      !BYTES32.test(pair.tickTableHash) || !Number.isSafeInteger(pair.privateTokenRuntimeManifestLength) ||
      pair.privateTokenRuntimeManifestLength <= 0 || !Number.isSafeInteger(pair.baseDecimals) ||
      pair.baseDecimals < 0 || pair.baseDecimals > 255 || !Number.isSafeInteger(pair.quoteDecimals) ||
      pair.quoteDecimals < 0 || pair.quoteDecimals > 255 ||
      typeof pair.baseLotSize !== 'string' || !POSITIVE_DECIMAL.test(pair.baseLotSize) ||
      typeof pair.quoteLotSize !== 'string' || !POSITIVE_DECIMAL.test(pair.quoteLotSize) ||
      typeof pair.maximumAggregateLots !== 'string' || !POSITIVE_DECIMAL.test(pair.maximumAggregateLots) ||
      !baseComponent || !quoteComponent || pair.baseToken.toLowerCase() !== baseComponent.address.toLowerCase() ||
      pair.quoteToken.toLowerCase() !== quoteComponent.address.toLowerCase() ||
      pair.baseTokenRuntimeHash.toLowerCase() !== baseComponent.runtimeBytecodeHash.toLowerCase() ||
      pair.quoteTokenRuntimeHash.toLowerCase() !== quoteComponent.runtimeBytecodeHash.toLowerCase() ||
      !activation || activation.result !== 'pass' || activation.transactionCount !== 16 ||
      activation.measuredRouteCount !== 4 || !exactBlock(activation.finalBlock) ||
      activation.allProofsPassed !== true || activation.routeGasP95Passed !== true ||
      activation.routeGasMaximumPassed !== true || activation.routeLatencyP95Passed !== true ||
      BigInt(activation.finalBlock.number) < BigInt(anchors.pairRegistration.number)) {
    throw new Error('DEX V2 activated app manifest identity is invalid.');
  }
  return [
    'VITE_CHAINWHISPER_DEX_V2_ENABLED=true',
    `VITE_CHAINWHISPER_DEX_V2_MANIFEST='${JSON.stringify(manifest)}'`,
    'VITE_CHAINWHISPER_DEX_V2_FINALITY_LAG_BLOCKS=5',
    'VITE_CHAINWHISPER_DEX_V2_RPC_URL=https://testnet.coti.io/rpc'
  ];
};

export const buildSuccessorDexEnv = (manifestText) => {
  if (manifestText === undefined) return [];
  let manifest;
  try {
    manifest = JSON.parse(manifestText);
  } catch {
    throw new Error('Successor DEX app manifest must be valid JSON.');
  }
  if (manifest?.status === 'deployed-seeded-app-integration-pending' && manifest.appReady === false) {
    return [];
  }
  const graph = manifest?.contracts && typeof manifest.contracts === 'object' && !Array.isArray(manifest.contracts)
    ? manifest.contracts
    : {};
  const contracts = Object.values(graph);
  const receipts = Array.isArray(manifest?.receipts) ? manifest.receipts : [];
  const exactRole = (key, contractName, expectedAddress) => {
    const entry = graph[key];
    return entry && entry.contractName === contractName && ADDRESS.test(entry.address) &&
      entry.address.toLowerCase() !== ZERO_ADDRESS &&
      (expectedAddress === undefined || entry.address.toLowerCase() === expectedAddress.toLowerCase());
  };
  const pairRolesMatch = Array.isArray(manifest?.pairs) && manifest.pairs.every((pair) => {
    if (!pair || typeof pair.displayPair !== 'string') return false;
    const label = pair.displayPair.replaceAll('/', '-').toLowerCase();
    const coordinatorKey = `spb-${label}-coordinator`;
    const epochKey = `spb-${label}-epoch`;
    if (pair.sourceCount === 0) {
      return pair.coordinator === null && pair.epochController === null &&
        graph[coordinatorKey] === undefined && graph[epochKey] === undefined;
    }
    return typeof pair.coordinator === 'string' && typeof pair.epochController === 'string' &&
      pair.coordinatorSemanticId === SUCCESSOR_L8_SEMANTIC_ID &&
      exactRole(coordinatorKey, SUCCESSOR_PAIR_GRAPH_ROLES.coordinator, pair.coordinator) &&
      exactRole(epochKey, SUCCESSOR_PAIR_GRAPH_ROLES.epoch, pair.epochController) &&
      graph[coordinatorKey].semanticId === SUCCESSOR_L8_SEMANTIC_ID;
  });
  const receiptHashes = new Set(receipts.map(({ transactionHash }) =>
    typeof transactionHash === 'string' ? transactionHash.toLowerCase() : ''));
  const requiredReceiptHashes = [
    ...contracts.map(({ deploymentTxHash }) => deploymentTxHash),
    ...(Array.isArray(manifest?.tokens) ? manifest.tokens.flatMap(({ deploymentTxHash, seedMintTxHash }) =>
      [deploymentTxHash, seedMintTxHash]) : []),
    ...(Array.isArray(manifest?.strategies) ? manifest.strategies.map(({ transactionHash }) => transactionHash) : [])
  ];
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest) ||
      manifest.schemaVersion !== 1 || manifest.status !== 'deployed-seeded-app-ready' ||
      manifest.appReady !== true || manifest.network !== 'cotiTestnet' || manifest.chainId !== '7082400' ||
      !BYTES32.test(manifest.releaseIdentityHash) || !BYTES32.test(manifest.buildHash) ||
      !Array.isArray(manifest.deploymentBlockRange) || manifest.deploymentBlockRange.length !== 2 ||
      manifest.deploymentBlockRange.some((block) => !Number.isSafeInteger(block) || block <= 0) ||
      contracts.length === 0 || contracts.some((contract) =>
        !contract || typeof contract !== 'object' || !ADDRESS.test(contract.address) ||
        contract.address.toLowerCase() === ZERO_ADDRESS || !BYTES32.test(contract.runtimeHash) ||
        typeof contract.contractName !== 'string' || !contract.contractName) ||
      new Set(contracts.map(({ address }) => address.toLowerCase())).size !== contracts.length ||
      !exactRole('global-core', SUCCESSOR_GRAPH_ROLES['global-core'], manifest.globalCore) ||
      !exactRole('position-nft', SUCCESSOR_GRAPH_ROLES['position-nft'], manifest.positionNFT) ||
      !exactRole('work-authority', SUCCESSOR_GRAPH_ROLES['work-authority']) ||
      !Array.isArray(manifest.tokens) || manifest.tokens.length !== 4 ||
      !Array.isArray(manifest.pairs) || manifest.pairs.length !== 6 ||
      !pairRolesMatch ||
      manifest.privateBookWorkProfile?.inputLatticeCells !== 8 ||
      manifest.privateBookWorkProfile?.maximumInputLots !== '7' ||
      manifest.privateBookWorkProfile?.semanticId !== SUCCESSOR_L8_SEMANTIC_ID ||
      !Array.isArray(manifest.strategies) || manifest.strategies.length !== 7 ||
      typeof manifest.strategyOwner !== 'string' ||
      manifest.strategyOwner.toLowerCase() !== '0x5dfcee20b5a3fdd3577436a32f62d4c0b39e979d' ||
      manifest.p2?.routeCount !== 6 || manifest.p2?.successfulRouteLiquiditySupported !== false ||
      manifest.c1?.cycleCount !== 2 || receipts.length === 0 ||
      receipts.some(({ status, transactionHash }) =>
        status !== 'MINED' || !BYTES32.test(transactionHash)) ||
      receiptHashes.size !== receipts.length ||
      requiredReceiptHashes.some((transactionHash) =>
        !BYTES32.test(transactionHash) || !receiptHashes.has(transactionHash.toLowerCase())) ||
      typeof manifest.spend?.actualGasSpendWei !== 'string' ||
      typeof manifest.spend?.authorizedCapWei !== 'string' ||
      BigInt(manifest.spend.actualGasSpendWei) > BigInt(manifest.spend.authorizedCapWei)) {
    throw new Error('Successor DEX deployed app manifest identity is invalid.');
  }
  return [
    'VITE_CHAINWHISPER_SUCCESSOR_DEX_ENABLED=true',
    'VITE_CHAINWHISPER_SUCCESSOR_DEX_MANIFEST_URL=/deployments/coti-testnet-successor-app-manifest.json',
    `VITE_CHAINWHISPER_SUCCESSOR_DEX_RELEASE_IDENTITY_HASH=${manifest.releaseIdentityHash.toLowerCase()}`,
    'VITE_CHAINWHISPER_SUCCESSOR_DEX_FINALITY_LAG_BLOCKS=5'
  ];
};

const buildDailyPriceEnv = (manifestText, unifiedManifest) => {
  if (manifestText === undefined) return ['VITE_CHAINWHISPER_PRIVATE_LIQUIDITY_DAILY_PRICE_ENABLED=false'];
  let manifest;
  try {
    manifest = JSON.parse(manifestText);
  } catch {
    throw new Error('Daily-price analytics candidate manifest must be valid JSON.');
  }
  const sourceBook = CURRENT_PRIVATE_LIQUIDITY.manifest.book;
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest) ||
      manifest.schemaVersion !== 1 ||
      manifest.status !== 'attested-analytics-candidate-not-app-active' ||
      manifest.network !== 'cotiTestnet' || manifest.chainId !== unifiedManifest.chainId ||
      manifest.analyticsKind !== 'private-liquidity-daily-marginal-price-v1' ||
      manifest.contract !== 'ChainWhisperPrivateLiquidityDailyPriceStoreV1' ||
      manifest.appActivated !== false || !hasExactManifestHash(manifest) ||
      typeof manifest.address !== 'string' || !ADDRESS.test(manifest.address) ||
      manifest.address.toLowerCase() === ZERO_ADDRESS ||
      typeof manifest.deploymentBlock !== 'string' || !POSITIVE_DECIMAL.test(manifest.deploymentBlock) ||
      !BYTES32.test(manifest.deploymentBlockHash) ||
      !BYTES32.test(manifest.deploymentTransactionHash) ||
      !BYTES32.test(manifest.runtimeBytecodeHash) ||
      typeof manifest.owner !== 'string' || !ADDRESS.test(manifest.owner) ||
      manifest.owner.toLowerCase() === ZERO_ADDRESS ||
      manifest.owner.toLowerCase() !== unifiedManifest.owner.toLowerCase() ||
      typeof manifest.recorder !== 'string' || !ADDRESS.test(manifest.recorder) ||
      manifest.recorder.toLowerCase() === ZERO_ADDRESS ||
      manifest.recorder.toLowerCase() === manifest.owner.toLowerCase() ||
      manifest.recorder.toLowerCase() === manifest.address.toLowerCase() ||
      !sourceBook || typeof manifest.sourceBook !== 'string' || !ADDRESS.test(manifest.sourceBook) ||
      manifest.sourceBook.toLowerCase() === ZERO_ADDRESS ||
      manifest.recorder.toLowerCase() === manifest.sourceBook.toLowerCase() ||
      manifest.address.toLowerCase() === manifest.sourceBook.toLowerCase() ||
      typeof manifest.sourceBookRuntimeHash !== 'string' || !BYTES32.test(manifest.sourceBookRuntimeHash) ||
      manifest.sourceBook.toLowerCase() !== sourceBook.address.toLowerCase() ||
      manifest.sourceBookRuntimeHash.toLowerCase() !== sourceBook.runtimeBytecodeHash.toLowerCase() ||
      BigInt(manifest.deploymentBlock) < BigInt(sourceBook.deploymentBlock)) {
    throw new Error('Daily-price analytics candidate manifest identity is invalid.');
  }
  return [
    'VITE_CHAINWHISPER_PRIVATE_LIQUIDITY_DAILY_PRICE_ENABLED=true',
    `VITE_CHAINWHISPER_PRIVATE_LIQUIDITY_DAILY_PRICE_ADDRESS=${manifest.address}`,
    `VITE_CHAINWHISPER_PRIVATE_LIQUIDITY_DAILY_PRICE_DEPLOYMENT_BLOCK=${manifest.deploymentBlock}`,
    `VITE_CHAINWHISPER_PRIVATE_LIQUIDITY_DAILY_PRICE_DEPLOYMENT_BLOCK_HASH=${manifest.deploymentBlockHash}`,
    `VITE_CHAINWHISPER_PRIVATE_LIQUIDITY_DAILY_PRICE_TRANSACTION_HASH=${manifest.deploymentTransactionHash}`,
    `VITE_CHAINWHISPER_PRIVATE_LIQUIDITY_DAILY_PRICE_RUNTIME_HASH=${manifest.runtimeBytecodeHash}`,
    `VITE_CHAINWHISPER_PRIVATE_LIQUIDITY_DAILY_PRICE_OWNER=${manifest.owner}`,
    `VITE_CHAINWHISPER_PRIVATE_LIQUIDITY_DAILY_PRICE_RECORDER=${manifest.recorder}`
  ];
};

export const buildTestnetCandidateModeEnv = (
  manifestText,
  dailyPriceManifestText,
  successorDexManifestText
) => {
  let manifest;
  try {
    manifest = JSON.parse(manifestText);
  } catch {
    throw new Error('Unified testnet candidate manifest must be valid JSON.');
  }
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest) ||
      manifest.schemaVersion !== 1 ||
      manifest.status !== 'attested-testnet-candidate-not-app-active' ||
      manifest.network !== 'cotiTestnet' || manifest.chainId !== '7082400' ||
      typeof manifest.owner !== 'string' || !ADDRESS.test(manifest.owner) ||
      manifest.owner.toLowerCase() === ZERO_ADDRESS ||
      !BYTES32.test(manifest.manifestHash) ||
      !Array.isArray(manifest.components) || manifest.components.length !== 15 ||
      new Set(manifest.components.map(({ key }) => key)).size !== 15 ||
      manifest.components.some(({ address, runtimeBytecodeHash, deploymentBlock }) =>
        typeof address !== 'string' || !BYTES32.test(runtimeBytecodeHash) ||
        typeof deploymentBlock !== 'string' || !POSITIVE_DECIMAL.test(deploymentBlock)) ||
      !manifest.relationships || manifest.relationships.tokenAdmissionOperations !== 16 ||
      manifest.relationships.appActivated !== false) {
    throw new Error('Unified testnet candidate manifest identity is invalid.');
  }
  const compactManifest = JSON.stringify(manifest);
  const successorDexEnv = buildSuccessorDexEnv(successorDexManifestText);
  return [
    'VITE_CHAINWHISPER_TESTNET_CANDIDATE_ENABLED=true',
    'VITE_CHAINWHISPER_NETWORK_ID=coti-testnet',
    `VITE_CHAINWHISPER_TESTNET_CANDIDATE_MANIFEST='${compactManifest}'`,
    'VITE_CHAINWHISPER_TESTNET_FINALITY_LAG_BLOCKS=5',
    'VITE_CHAINWHISPER_TESTNET_RPC_URL=https://testnet.coti.io/rpc',
    ...buildDailyPriceEnv(dailyPriceManifestText, manifest),
    ...successorDexEnv,
    'VITE_CHAINWHISPER_DEX_V2_ENABLED=false',
    ''
  ].join('\n');
};

export const prepareTestnetCandidateMode = async () => {
  let dailyPriceManifestText;
  let successorDexManifestText;
  try {
    dailyPriceManifestText = await readFile(DAILY_PRICE_MANIFEST_PATH, 'utf8');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  try {
    successorDexManifestText = await readFile(SUCCESSOR_DEX_MANIFEST_PATH, 'utf8');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  const modeEnv = buildTestnetCandidateModeEnv(
    await readFile(MANIFEST_PATH, 'utf8'),
    dailyPriceManifestText,
    successorDexManifestText
  );
  if (successorDexManifestText !== undefined) {
    await mkdir(dirname(PUBLIC_SUCCESSOR_DEX_MANIFEST_PATH), { recursive: true });
    let currentPublicManifest;
    try {
      currentPublicManifest = await readFile(PUBLIC_SUCCESSOR_DEX_MANIFEST_PATH, 'utf8');
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    if (currentPublicManifest !== successorDexManifestText) {
      const temporaryManifest = `${PUBLIC_SUCCESSOR_DEX_MANIFEST_PATH}.tmp`;
      await writeFile(temporaryManifest, successorDexManifestText, { encoding: 'utf8', flag: 'w' });
      await rename(temporaryManifest, PUBLIC_SUCCESSOR_DEX_MANIFEST_PATH);
    }
  }
  try {
    if (await readFile(OUTPUT_PATH, 'utf8') === modeEnv) {
      return OUTPUT_PATH;
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      throw error;
    }
  }
  const temporary = `${OUTPUT_PATH}.tmp`;
  await writeFile(temporary, modeEnv, { encoding: 'utf8', flag: 'w' });
  await rename(temporary, OUTPUT_PATH);
  return OUTPUT_PATH;
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  prepareTestnetCandidateMode()
    .then(() => console.log('PASS: prepared the local COTI-testnet candidate mode from the attested manifest.'))
    .catch(() => {
      console.error('Testnet candidate mode preparation failed closed; no APP configuration was replaced.');
      process.exitCode = 1;
    });
}
