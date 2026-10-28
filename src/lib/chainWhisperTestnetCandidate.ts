import { getAddress, keccak256, toUtf8Bytes } from '@coti-io/coti-ethers';

const DECIMAL = /^(0|[1-9][0-9]*)$/;
const BYTES32 = /^0x[0-9a-fA-F]{64}$/;
const ZERO_ADDRESS = `0x${'00'.repeat(20)}`;
const ZERO_BYTES32 = `0x${'00'.repeat(32)}`;
const COTI_TESTNET_CHAIN_ID = '7082400';

export const TESTNET_CANDIDATE_ENV_KEYS = Object.freeze({
  enabled: 'VITE_CHAINWHISPER_TESTNET_CANDIDATE_ENABLED',
  manifest: 'VITE_CHAINWHISPER_TESTNET_CANDIDATE_MANIFEST',
  finalityLagBlocks: 'VITE_CHAINWHISPER_TESTNET_FINALITY_LAG_BLOCKS',
  rpcUrl: 'VITE_CHAINWHISPER_TESTNET_RPC_URL'
} as const);

export const TESTNET_CANDIDATE_COMPONENTS = Object.freeze({
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
} as const);

export type TestnetCandidateComponentKey = keyof typeof TESTNET_CANDIDATE_COMPONENTS;

export type TestnetCandidateComponent = Readonly<{
  key: TestnetCandidateComponentKey;
  contract: string;
  address: string;
  runtimeBytecodeHash: string;
  deploymentBlock?: string;
}>;

export type ActiveTestnetCandidateConfig = Readonly<{
  status: 'active';
  manifestHash: string;
  chainId: typeof COTI_TESTNET_CHAIN_ID;
  owner: string;
  attestationBlock: Readonly<{ number: string; hash: string }>;
  components: Readonly<Record<TestnetCandidateComponentKey, TestnetCandidateComponent>>;
  finalityLagBlocks: bigint;
  rpcUrl: string;
  fingerprint: string;
}>;

export type TestnetCandidateConfig =
  | Readonly<{ status: 'inactive' }>
  | Readonly<{ status: 'invalid'; error: string }>
  | ActiveTestnetCandidateConfig;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const exactKeys = (record: Record<string, unknown>, expected: readonly string[], label: string): void => {
  const actual = Object.keys(record).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new Error(`${label} fields are invalid.`);
  }
};

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)])
    );
  }
  return value;
};

const decimal = (value: unknown, label: string, maximum?: bigint): string => {
  if (typeof value !== 'string' || !DECIMAL.test(value)) throw new Error(`${label} must be canonical decimal.`);
  const parsed = BigInt(value);
  if (parsed <= 0n || (maximum !== undefined && parsed > maximum)) throw new Error(`${label} is out of range.`);
  return value;
};

const address = (value: unknown, label: string): string => {
  if (typeof value !== 'string') throw new Error(`${label} is invalid.`);
  let normalized: string;
  try {
    normalized = getAddress(value).toLowerCase();
  } catch {
    throw new Error(`${label} is invalid.`);
  }
  if (normalized === ZERO_ADDRESS) throw new Error(`${label} cannot be zero.`);
  return normalized;
};

const hash = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || !BYTES32.test(value) || value.toLowerCase() === ZERO_BYTES32) {
    throw new Error(`${label} must be non-zero bytes32.`);
  }
  return value.toLowerCase();
};

const rpcUrl = (value: unknown): string => {
  if (typeof value !== 'string' || value !== value.trim()) throw new Error('Testnet RPC URL is invalid.');
  try {
    const parsed = new URL(value);
    if (
      parsed.username ||
      parsed.password ||
      (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') ||
      (parsed.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname))
    ) {
      throw new Error('unsupported');
    }
    return parsed.toString();
  } catch {
    throw new Error('Testnet RPC URL must be HTTPS or credential-free local HTTP.');
  }
};

const readRequiredEnv = (env: Readonly<Record<string, unknown>>, key: string): string => {
  const value = env[key];
  if (typeof value !== 'string' || value.length === 0 || value !== value.trim()) {
    throw new Error(`Testnet candidate requires ${key}.`);
  }
  return value;
};

const parseComponent = (value: unknown): TestnetCandidateComponent => {
  if (!isRecord(value)) throw new Error('Candidate component is invalid.');
  const hasBlock = Object.prototype.hasOwnProperty.call(value, 'deploymentBlock');
  exactKeys(
    value,
    hasBlock
      ? ['key', 'contract', 'address', 'runtimeBytecodeHash', 'deploymentBlock']
      : ['key', 'contract', 'address', 'runtimeBytecodeHash'],
    'Candidate component'
  );
  const key = value.key;
  if (typeof key !== 'string' || !(key in TESTNET_CANDIDATE_COMPONENTS)) {
    throw new Error('Candidate component key is invalid.');
  }
  const typedKey = key as TestnetCandidateComponentKey;
  const contract = value.contract;
  if (typeof contract !== 'string' || contract !== TESTNET_CANDIDATE_COMPONENTS[typedKey]) {
    throw new Error(`Candidate component ${key} contract identity is invalid.`);
  }
  if (!hasBlock) {
    throw new Error(`Candidate component ${key} requires a deployment block.`);
  }
  return Object.freeze({
    key: typedKey,
    contract,
    address: address(value.address, `${key} address`),
    runtimeBytecodeHash: hash(value.runtimeBytecodeHash, `${key} runtime hash`),
    ...(hasBlock ? { deploymentBlock: decimal(value.deploymentBlock, `${key} deployment block`, (1n << 64n) - 1n) } : {})
  });
};

const parseManifest = (text: string) => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('Testnet candidate manifest must be valid JSON.');
  }
  if (!isRecord(parsed)) throw new Error('Testnet candidate manifest must be an object.');
  exactKeys(
    parsed,
    ['schemaVersion', 'status', 'network', 'chainId', 'owner', 'attestationBlock', 'components', 'relationships', 'manifestHash'],
    'Testnet candidate manifest'
  );
  if (
    parsed.schemaVersion !== 1 ||
    parsed.status !== 'attested-testnet-candidate-not-app-active' ||
    parsed.network !== 'cotiTestnet' ||
    parsed.chainId !== COTI_TESTNET_CHAIN_ID
  ) {
    throw new Error('Testnet candidate identity is invalid.');
  }
  if (!isRecord(parsed.attestationBlock)) throw new Error('Candidate attestation block is invalid.');
  exactKeys(parsed.attestationBlock, ['number', 'hash'], 'Candidate attestation block');
  const attestationBlock = Object.freeze({
    number: decimal(parsed.attestationBlock.number, 'Candidate attestation block', (1n << 64n) - 1n),
    hash: hash(parsed.attestationBlock.hash, 'Candidate attestation block hash')
  });
  if (!Array.isArray(parsed.components) || parsed.components.length !== 15) {
    throw new Error('Testnet candidate must contain exactly 15 components.');
  }
  const entries = parsed.components.map(parseComponent);
  if (new Set(entries.map(({ key }) => key)).size !== 15) throw new Error('Candidate component keys must be unique.');
  if (new Set(entries.map(({ address: item }) => item)).size !== 15) throw new Error('Candidate component addresses must be distinct.');
  const components = Object.freeze(Object.fromEntries(entries.map((entry) => [entry.key, entry]))) as Readonly<
    Record<TestnetCandidateComponentKey, TestnetCandidateComponent>
  >;
  if (!isRecord(parsed.relationships)) throw new Error('Candidate relationships are invalid.');
  exactKeys(parsed.relationships, ['chatReactionsV1', 'tokenAdmissionOperations', 'appActivated'], 'Candidate relationships');
  if (!isRecord(parsed.relationships.chatReactionsV1)) throw new Error('Candidate reaction relationship is invalid.');
  exactKeys(parsed.relationships.chatReactionsV1, ['directChatV2', 'groupChatV2'], 'Candidate reaction relationship');
  if (
    parsed.relationships.tokenAdmissionOperations !== 16 ||
    parsed.relationships.appActivated !== false ||
    address(parsed.relationships.chatReactionsV1.directChatV2, 'Reaction Direct target') !== components.directChatV2.address ||
    address(parsed.relationships.chatReactionsV1.groupChatV2, 'Reaction Group target') !== components.groupChatV2.address
  ) {
    throw new Error('Candidate relationships do not match the attested components.');
  }
  const manifestHash = hash(parsed.manifestHash, 'Candidate manifest hash');
  const { manifestHash: _ignored, ...body } = parsed;
  const calculatedHash = keccak256(toUtf8Bytes(JSON.stringify(canonicalize(body)))).toLowerCase();
  if (calculatedHash !== manifestHash) throw new Error('Candidate manifest hash is invalid.');
  return Object.freeze({
    manifestHash,
    owner: address(parsed.owner, 'Candidate owner'),
    attestationBlock,
    components
  });
};

export const parseTestnetCandidateConfig = (
  env: Readonly<Record<string, unknown>>
): TestnetCandidateConfig => {
  const enabled = env[TESTNET_CANDIDATE_ENV_KEYS.enabled];
  if (enabled === undefined || enabled === '' || enabled === 'false') {
    return Object.freeze({ status: 'inactive' });
  }
  if (enabled !== 'true') throw new Error(`${TESTNET_CANDIDATE_ENV_KEYS.enabled} must be exactly true or false.`);
  const manifest = parseManifest(readRequiredEnv(env, TESTNET_CANDIDATE_ENV_KEYS.manifest));
  const finalityText = readRequiredEnv(env, TESTNET_CANDIDATE_ENV_KEYS.finalityLagBlocks);
  const finalityLagBlocks = BigInt(decimal(finalityText, 'Testnet finality lag', 4_096n));
  const resolvedRpcUrl = rpcUrl(readRequiredEnv(env, TESTNET_CANDIDATE_ENV_KEYS.rpcUrl));
  return Object.freeze({
    status: 'active',
    manifestHash: manifest.manifestHash,
    chainId: COTI_TESTNET_CHAIN_ID,
    owner: manifest.owner,
    attestationBlock: manifest.attestationBlock,
    components: manifest.components,
    finalityLagBlocks,
    rpcUrl: resolvedRpcUrl,
    fingerprint: [
      'chainwhisper-testnet-candidate-v1',
      manifest.manifestHash,
      manifest.attestationBlock.number,
      manifest.attestationBlock.hash,
      finalityLagBlocks.toString(),
      resolvedRpcUrl
    ].join(':')
  });
};

export const resolveTestnetCandidateConfig = (
  env: Readonly<Record<string, unknown>>
): TestnetCandidateConfig => {
  try {
    return parseTestnetCandidateConfig(env);
  } catch {
    return Object.freeze({ status: 'invalid', error: 'ChainWhisper testnet candidate configuration is invalid.' });
  }
};

export const CHAINWHISPER_TESTNET_CANDIDATE_CONFIG = resolveTestnetCandidateConfig(import.meta.env);
