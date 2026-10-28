import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Interface, keccak256, toUtf8Bytes } from '@coti-io/coti-ethers';

import {
  parseActionRuntimeCatalogV2,
  parseTestnetCandidateManifest
} from '../../MCP/dist/shared/index.js';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WORKSPACE_ROOT = resolve(APP_ROOT, '..');

export const RELEASE_COMPATIBILITY_PATHS = Object.freeze({
  candidate: resolve(
    WORKSPACE_ROOT,
    'ChainWhisper Contracts',
    'deployments',
    'coti-testnet-unified-candidate.json'
  ),
  catalog: resolve(WORKSPACE_ROOT, 'MCP', 'runtime', 'coti-testnet-action-runtime-v2.json'),
  analyticsManifest: resolve(
    WORKSPACE_ROOT,
    'ChainWhisper Contracts',
    'deployments',
    'coti-testnet-private-liquidity-daily-price-store.json'
  ),
  appEnv: resolve(APP_ROOT, '.env.coti-testnet-candidate.local'),
  directArtifact: resolve(
    WORKSPACE_ROOT,
    'ChainWhisper Contracts',
    'artifacts',
    'contracts',
    'editable',
    'ChainWhisperChatV2.sol',
    'ChainWhisperChatV2.json'
  ),
  groupArtifact: resolve(
    WORKSPACE_ROOT,
    'ChainWhisper Contracts',
    'artifacts',
    'contracts',
    'editable',
    'ChainWhisperGroupChatV2.sol',
    'ChainWhisperGroupChatV2.json'
  ),
  supabaseConfirm: resolve(APP_ROOT, 'supabase', 'functions', 'chat-image-confirm', 'index.ts'),
  readCursorMigration: resolve(
    APP_ROOT,
    'supabase',
    'migrations',
    '20260813145601_chat_read_cursor_sync.sql'
  ),
  workerIndex: resolve(APP_ROOT, 'workers', 'chainwhisper-api', 'src', 'index.ts'),
  workerCandidateParser: resolve(
    APP_ROOT,
    'workers',
    'chainwhisper-api',
    'src',
    'privateLiquidityV2.ts'
  ),
  output: resolve(APP_ROOT, 'docs', 'COTI_TESTNET_RELEASE_COMPATIBILITY.md')
});

const OFFICIAL_TESTNET_RPC = 'https://testnet.coti.io/rpc';
const POSITIVE_DECIMAL = /^[1-9][0-9]*$/u;
const BYTES32 = /^0x[0-9a-fA-F]{64}$/u;

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

const requireCondition = (condition, message) => {
  if (!condition) throw new Error(message);
};

const parsePublicEnv = (text) => {
  const values = new Map();
  for (const rawLine of text.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    requireCondition(separator > 0, 'APP candidate environment contains a malformed line.');
    const key = line.slice(0, separator);
    let value = line.slice(separator + 1);
    requireCondition(!values.has(key), `APP candidate environment duplicates ${key}.`);
    if (
      value.length >= 2 &&
      ((value.startsWith("'") && value.endsWith("'")) ||
        (value.startsWith('"') && value.endsWith('"')))
    ) {
      value = value.slice(1, -1);
    }
    values.set(key, value);
  }
  return values;
};

const parseArtifactAbi = (text, label) => {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`${label} artifact must be valid JSON.`);
  }
  requireCondition(Array.isArray(parsed?.abi), `${label} artifact ABI is missing.`);
  return parsed.abi;
};

const sourceConstant = (source, name) => {
  const match = source.match(new RegExp(`\\b${name}\\s*=\\s*['"](0x[0-9a-fA-F]+)['"]`, 'u'));
  requireCondition(match, `Supabase chat-image confirmation is missing ${name}.`);
  return match[1].toLowerCase();
};

const componentConsumers = (key) => {
  if (key === 'directChatV2' || key === 'groupChatV2') return 'APP, MCP, Supabase images';
  if (key === 'chatReactionsV1') return 'APP, MCP';
  if (key.startsWith('privateLiquidity')) return 'APP, Worker/API, MCP';
  return 'APP, MCP';
};

const cell = (value) => String(value).replaceAll('|', '\\|');

export const buildTestnetReleaseCompatibilityMatrix = ({
  candidateText,
  catalogText,
  analyticsManifestText,
  appEnvText,
  directArtifactText,
  groupArtifactText,
  supabaseConfirmSource,
  readCursorMigrationSource,
  workerIndexSource,
  workerCandidateParserSource
}) => {
  const candidate = parseTestnetCandidateManifest(candidateText);
  const catalog = parseActionRuntimeCatalogV2(catalogText);
  let analyticsManifest;
  try {
    analyticsManifest = JSON.parse(analyticsManifestText);
  } catch {
    throw new Error('Daily-price analytics manifest must be valid JSON.');
  }
  const { manifestHash: analyticsManifestHash, ...analyticsManifestBody } = analyticsManifest;
  requireCondition(
    typeof analyticsManifestHash === 'string' &&
      BYTES32.test(analyticsManifestHash) &&
      keccak256(toUtf8Bytes(JSON.stringify(canonicalize(analyticsManifestBody)))).toLowerCase() ===
        analyticsManifestHash.toLowerCase(),
    'Daily-price analytics manifest integrity check failed.'
  );
  const components = Object.values(candidate.components).sort((left, right) =>
    left.key.localeCompare(right.key)
  );

  requireCondition(catalog.body.profileId === 'coti-testnet', 'MCP catalog profile is not COTI testnet.');
  requireCondition(
    String(catalog.body.chainId) === candidate.chainId,
    'MCP catalog chain does not match the Contracts candidate.'
  );
  requireCondition(
    catalog.body.sourceManifestHash === candidate.manifestHash,
    'MCP catalog was generated from a different Contracts candidate.'
  );
  requireCondition(
    catalog.body.contracts.length === components.length,
    'MCP catalog does not cover the complete Contracts candidate.'
  );
  for (const component of components) {
    const runtime = catalog.contractsByKey[component.key];
    requireCondition(runtime, `MCP catalog is missing ${component.key}.`);
    requireCondition(
      runtime.contract === component.contract &&
        runtime.address === component.address.toLowerCase() &&
        runtime.runtimeCodeHash === component.runtimeBytecodeHash.toLowerCase() &&
        runtime.deploymentBlock === component.deploymentBlock,
      `MCP catalog drifted from ${component.key}.`
    );
  }

  const appEnv = parsePublicEnv(appEnvText);
  requireCondition(
    appEnv.get('VITE_CHAINWHISPER_TESTNET_CANDIDATE_ENABLED') === 'true' &&
      appEnv.get('VITE_CHAINWHISPER_NETWORK_ID') === 'coti-testnet' &&
      appEnv.get('VITE_CHAINWHISPER_TESTNET_RPC_URL') === OFFICIAL_TESTNET_RPC &&
      POSITIVE_DECIMAL.test(appEnv.get('VITE_CHAINWHISPER_TESTNET_FINALITY_LAG_BLOCKS') ?? ''),
    'APP candidate mode is not pinned to the reviewed COTI testnet boundary.'
  );
  const embeddedCandidate = parseTestnetCandidateManifest(
    appEnv.get('VITE_CHAINWHISPER_TESTNET_CANDIDATE_MANIFEST') ?? ''
  );
  requireCondition(
    embeddedCandidate.manifestHash === candidate.manifestHash,
    'APP candidate mode embeds a different Contracts candidate.'
  );

  const sourceBook = candidate.components.privateLiquidityBookV2;
  requireCondition(
    analyticsManifest.status === 'attested-analytics-candidate-not-app-active' &&
      analyticsManifest.network === 'cotiTestnet' &&
      analyticsManifest.analyticsKind === 'private-liquidity-daily-marginal-price-v1' &&
      analyticsManifest.contract === 'ChainWhisperPrivateLiquidityDailyPriceStoreV1' &&
      analyticsManifest.chainId === candidate.chainId &&
      analyticsManifest.appActivated === false &&
      analyticsManifest.sourceBook?.toLowerCase() === sourceBook.address.toLowerCase() &&
      analyticsManifest.sourceBookRuntimeHash?.toLowerCase() ===
        sourceBook.runtimeBytecodeHash.toLowerCase() &&
      analyticsManifest.owner?.toLowerCase() === candidate.owner.toLowerCase(),
    'Daily-price analytics manifest does not belong to the exact Contracts candidate.'
  );
  const analyticsEnvBindings = new Map([
    ['VITE_CHAINWHISPER_PRIVATE_LIQUIDITY_DAILY_PRICE_ADDRESS', analyticsManifest.address],
    ['VITE_CHAINWHISPER_PRIVATE_LIQUIDITY_DAILY_PRICE_DEPLOYMENT_BLOCK', analyticsManifest.deploymentBlock],
    ['VITE_CHAINWHISPER_PRIVATE_LIQUIDITY_DAILY_PRICE_DEPLOYMENT_BLOCK_HASH', analyticsManifest.deploymentBlockHash],
    ['VITE_CHAINWHISPER_PRIVATE_LIQUIDITY_DAILY_PRICE_TRANSACTION_HASH', analyticsManifest.deploymentTransactionHash],
    ['VITE_CHAINWHISPER_PRIVATE_LIQUIDITY_DAILY_PRICE_RUNTIME_HASH', analyticsManifest.runtimeBytecodeHash],
    ['VITE_CHAINWHISPER_PRIVATE_LIQUIDITY_DAILY_PRICE_OWNER', analyticsManifest.owner],
    ['VITE_CHAINWHISPER_PRIVATE_LIQUIDITY_DAILY_PRICE_RECORDER', analyticsManifest.recorder]
  ]);
  requireCondition(
    appEnv.get('VITE_CHAINWHISPER_PRIVATE_LIQUIDITY_DAILY_PRICE_ENABLED') === 'true' &&
      [...analyticsEnvBindings].every(([key, value]) =>
        appEnv.get(key)?.toLowerCase() === String(value).toLowerCase()
      ),
    'APP daily-price analytics projection drifted from the attested Store manifest.'
  );

  requireCondition(
    workerIndexSource.includes('CHAINWHISPER_TESTNET_CANDIDATE_MANIFEST_JSON?: string;') &&
      workerIndexSource.includes('new ManifestPrivateLiquidityV2ApiSource({') &&
      workerIndexSource.includes('manifestJson: testnetManifest'),
    'Worker/API no longer consumes the exact candidate manifest through its reviewed boundary.'
  );
  requireCondition(
    workerCandidateParserSource.includes('parsed.components.length !== 15') &&
      workerCandidateParserSource.includes("throw new Error('invalid candidate manifest hash')"),
    'Worker/API candidate parser no longer proves complete component coverage and manifest integrity.'
  );
  for (const component of components) {
    requireCondition(
      !workerIndexSource.toLowerCase().includes(component.address.toLowerCase()),
      `Worker/API embeds the current ${component.key} address instead of consuming the manifest.`
    );
  }

  const directInterface = new Interface(parseArtifactAbi(directArtifactText, 'Direct Chat V2'));
  const groupInterface = new Interface(parseArtifactAbi(groupArtifactText, 'Group Chat V2'));
  const directSelector = directInterface.getFunction('sendMessage')?.selector.toLowerCase();
  const groupSelector = groupInterface.getFunction('sendMessage')?.selector.toLowerCase();
  const directTopic = directInterface.getEvent('MessagePosted')?.topicHash.toLowerCase();
  const groupTopic = groupInterface.getEvent('GroupMessagePosted')?.topicHash.toLowerCase();
  requireCondition(
    directSelector && groupSelector && directTopic && groupTopic,
    'Compiled Chat V2 artifacts are missing the image-confirmation ABI surface.'
  );
  requireCondition(
    sourceConstant(supabaseConfirmSource, 'DIRECT_CHAT_V2_SEND_MESSAGE_SELECTOR') === directSelector &&
      sourceConstant(supabaseConfirmSource, 'GROUP_CHAT_V2_SEND_MESSAGE_SELECTOR') === groupSelector &&
      sourceConstant(supabaseConfirmSource, 'DIRECT_CHAT_V2_MESSAGE_POSTED_TOPIC') === directTopic &&
      sourceConstant(supabaseConfirmSource, 'GROUP_CHAT_V2_MESSAGE_POSTED_TOPIC') === groupTopic,
    'Supabase chat-image receipt selectors/topics drifted from the compiled Chat V2 artifacts.'
  );
  requireCondition(
    supabaseConfirmSource.includes("Deno.env.get('DIRECT_CHAT_V2_ADDRESS')") &&
      supabaseConfirmSource.includes("Deno.env.get('GROUP_CHAT_V2_ADDRESS')"),
    'Supabase chat-image confirmation must receive both exact Chat V2 addresses from deployment config.'
  );
  requireCondition(
    !supabaseConfirmSource.toLowerCase().includes(candidate.components.directChatV2.address.toLowerCase()) &&
      !supabaseConfirmSource.toLowerCase().includes(candidate.components.groupChatV2.address.toLowerCase()),
    'Supabase chat-image confirmation must not embed candidate addresses in source.'
  );

  const migration = readCursorMigrationSource.toLowerCase();
  requireCondition(
    migration.includes('create table public.chat_read_cursors') &&
      migration.includes('enable row level security') &&
      migration.includes('force row level security') &&
      migration.includes('auth.uid()) = user_id') &&
      migration.includes('generation'),
    'Supabase read-cursor migration lost its owner/RLS/reset-generation boundary.'
  );

  const analyticsMode = `Store \`${analyticsManifest.address}\` exactly manifest-bound`;

  const lines = [
    '# COTI Testnet Release Compatibility Matrix',
    '',
    'This file is generated from exact local artifacts by `npm run verify:testnet-compatibility`.',
    'It proves local compatibility, not remote configuration, wallet behavior, or release activation.',
    '',
    `- Contracts candidate: \`${candidate.manifestHash}\``,
    `- Candidate attestation block: \`${candidate.attestationBlock.number}\` / \`${candidate.attestationBlock.hash}\``,
    `- MCP runtime catalog: \`${catalog.manifestHash}\``,
    `- Chain: \`${candidate.chainId}\` (COTI testnet)`,
    `- Candidate activation: \`${candidate.relationships.appActivated}\``,
    '',
    '## Consumer status',
    '',
    '| Surface | Local authority | Local result | External release gate |',
    '|---|---|---|---|',
    `| Contracts | Unified candidate \`${candidate.manifestHash}\` | 15/15 exact components | Candidate remains intentionally inactive |`,
    `| APP | Embedded candidate manifest | Exact hash/chain/RPC/finality match | Live wallet journeys and release activation |`,
    `| Worker/API | Runtime manifest environment | Exact parser boundary; no embedded candidate address | Deployment environment and live read-only rehearsal |`,
    `| MCP | Runtime catalog \`${catalog.manifestHash}\` | 15/15 identity/runtime/deployment matches | Independent catalog-hash review and signer canary |`,
    `| Supabase images | Compiled Direct/Group selectors and event topics | ABI exact; addresses remain deployment settings | Set and verify remote Direct/Group addresses |`,
    `| Supabase read cursors | Owner-forced RLS migration | Local migration contains owner and generation guards | Apply/lint remotely and run two-device isolation |`,
    `| Daily-price chart | Separate analytics authority | ${analyticsMode} | Record the first finalized UTC close and verify automatic demo-to-live transition |`,
    '',
    '## Exact component graph',
    '',
    '| Key | Contract | Address | Runtime hash | Deployment block | Consumers |',
    '|---|---|---|---|---:|---|',
    ...components.map((component) =>
      `| ${cell(component.key)} | ${cell(component.contract)} | \`${component.address}\` | \`${component.runtimeBytecodeHash}\` | ${component.deploymentBlock} | ${componentConsumers(component.key)} |`
    ),
    '',
    '## Supabase Chat V2 deployment settings',
    '',
    `- \`DIRECT_CHAT_V2_ADDRESS=${candidate.components.directChatV2.address}\``,
    `- \`GROUP_CHAT_V2_ADDRESS=${candidate.components.groupChatV2.address}\``,
    `- Direct send selector: \`${directSelector}\``,
    `- Group send selector: \`${groupSelector}\``,
    `- Direct message topic: \`${directTopic}\``,
    `- Group message topic: \`${groupTopic}\``,
    '',
    'Remote values are deliberately reported as unverified until deployment tooling or a live read-only check proves them.',
    ''
  ];
  return `${lines.join('\n')}`;
};

export const loadTestnetReleaseCompatibilityInputs = async (paths = RELEASE_COMPATIBILITY_PATHS) => {
  const [
    candidateText,
    catalogText,
    analyticsManifestText,
    appEnvText,
    directArtifactText,
    groupArtifactText,
    supabaseConfirmSource,
    readCursorMigrationSource,
    workerIndexSource,
    workerCandidateParserSource
  ] = await Promise.all([
    readFile(paths.candidate, 'utf8'),
    readFile(paths.catalog, 'utf8'),
    readFile(paths.analyticsManifest, 'utf8'),
    readFile(paths.appEnv, 'utf8'),
    readFile(paths.directArtifact, 'utf8'),
    readFile(paths.groupArtifact, 'utf8'),
    readFile(paths.supabaseConfirm, 'utf8'),
    readFile(paths.readCursorMigration, 'utf8'),
    readFile(paths.workerIndex, 'utf8'),
    readFile(paths.workerCandidateParser, 'utf8')
  ]);
  return {
    candidateText,
    catalogText,
    analyticsManifestText,
    appEnvText,
    directArtifactText,
    groupArtifactText,
    supabaseConfirmSource,
    readCursorMigrationSource,
    workerIndexSource,
    workerCandidateParserSource
  };
};

export const verifyAndWriteTestnetReleaseCompatibility = async (
  paths = RELEASE_COMPATIBILITY_PATHS
) => {
  const report = buildTestnetReleaseCompatibilityMatrix(
    await loadTestnetReleaseCompatibilityInputs(paths)
  );
  await mkdir(dirname(paths.output), { recursive: true });
  try {
    if (await readFile(paths.output, 'utf8') === report) return paths.output;
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  const temporary = `${paths.output}.tmp`;
  await writeFile(temporary, report, { encoding: 'utf8', flag: 'w' });
  await rename(temporary, paths.output);
  return paths.output;
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  verifyAndWriteTestnetReleaseCompatibility()
    .then((output) => console.log(`PASS: verified and wrote ${output}.`))
    .catch(() => {
      console.error('COTI testnet release compatibility verification failed closed; no matrix was replaced.');
      process.exitCode = 1;
    });
}
