import { getAddress } from '@coti-io/coti-ethers';
import current from './currentPrivateLiquidityBinding.json';
import {
  CHAINWHISPER_TESTNET_CANDIDATE_CONFIG,
  resolveTestnetCandidateConfig,
  type TestnetCandidateConfig
} from './chainWhisperTestnetCandidate';

const DECIMAL = /^(0|[1-9][0-9]*)$/;
const BYTES32 = /^0x[0-9a-fA-F]{64}$/;
const ZERO_ADDRESS = `0x${'00'.repeat(20)}`;
const ZERO_BYTES32 = `0x${'00'.repeat(32)}`;
const UINT64_MAX = (1n << 64n) - 1n;
const REJECTED_HIDDEN_INTENT_RUNTIME_HASHES = new Set([
  '0xb67819b84429775d5456868941edc4e61203b1bde1a8e27433bf19922df7601f'
]);

export const PRIVATE_LIQUIDITY_V2_ENV_KEYS = Object.freeze({
  enabled: 'VITE_CHAINWHISPER_PRIVATE_LIQUIDITY_V2_ENABLED',
  chainId: 'VITE_CHAINWHISPER_PRIVATE_LIQUIDITY_V2_CHAIN_ID',
  bookAddress: 'VITE_CHAINWHISPER_PRIVATE_LIQUIDITY_V2_BOOK_ADDRESS',
  bookDeploymentBlock: 'VITE_CHAINWHISPER_PRIVATE_LIQUIDITY_V2_BOOK_DEPLOYMENT_BLOCK',
  bookDeploymentBlockHash: 'VITE_CHAINWHISPER_PRIVATE_LIQUIDITY_V2_BOOK_DEPLOYMENT_BLOCK_HASH',
  bookCreationTransactionHash: 'VITE_CHAINWHISPER_PRIVATE_LIQUIDITY_V2_BOOK_CREATION_TRANSACTION_HASH',
  bookRuntimeHash: 'VITE_CHAINWHISPER_PRIVATE_LIQUIDITY_V2_BOOK_RUNTIME_HASH',
  moduleAddress: 'VITE_CHAINWHISPER_PRIVATE_LIQUIDITY_V2_MODULE_ADDRESS',
  moduleDeploymentBlock: 'VITE_CHAINWHISPER_PRIVATE_LIQUIDITY_V2_MODULE_DEPLOYMENT_BLOCK',
  moduleDeploymentBlockHash: 'VITE_CHAINWHISPER_PRIVATE_LIQUIDITY_V2_MODULE_DEPLOYMENT_BLOCK_HASH',
  moduleCreationTransactionHash: 'VITE_CHAINWHISPER_PRIVATE_LIQUIDITY_V2_MODULE_CREATION_TRANSACTION_HASH',
  moduleRuntimeHash: 'VITE_CHAINWHISPER_PRIVATE_LIQUIDITY_V2_MODULE_RUNTIME_HASH',
  positionTokenAddress: 'VITE_CHAINWHISPER_PRIVATE_LIQUIDITY_V2_POSITION_TOKEN_ADDRESS',
  positionTokenDeploymentBlockHash:
    'VITE_CHAINWHISPER_PRIVATE_LIQUIDITY_V2_POSITION_TOKEN_DEPLOYMENT_BLOCK_HASH',
  positionTokenCreationTransactionHash:
    'VITE_CHAINWHISPER_PRIVATE_LIQUIDITY_V2_POSITION_TOKEN_CREATION_TRANSACTION_HASH',
  positionTokenRuntimeHash: 'VITE_CHAINWHISPER_PRIVATE_LIQUIDITY_V2_POSITION_TOKEN_RUNTIME_HASH',
  finalityLagBlocks: 'VITE_CHAINWHISPER_PRIVATE_LIQUIDITY_V2_FINALITY_LAG_BLOCKS',
  rpcUrl: 'VITE_CHAINWHISPER_PRIVATE_LIQUIDITY_V2_RPC_URL'
} as const);

export type PrivateLiquidityV2Manifest = Readonly<{
  chainId: string;
  book: Readonly<{
    address: string;
    deploymentBlock: string;
    deploymentBlockHash: string;
    creationTransactionHash: string;
    runtimeBytecodeHash: string;
  }>;
  hiddenIntentModule: Readonly<{
    address: string;
    deploymentBlock: string;
    deploymentBlockHash: string;
    creationTransactionHash: string;
    runtimeBytecodeHash: string;
  }>;
  positionToken: Readonly<{
    address: string;
    deploymentBlock: string;
    deploymentBlockHash: string;
    creationTransactionHash: string;
    runtimeBytecodeHash: string;
  }>;
}>;

export type PrivateLiquidityV2DeploymentConfig =
  | Readonly<{ status: 'inactive' }>
  | Readonly<{ status: 'invalid'; error: string }>
  | Readonly<{
      status: 'active';
      manifest: PrivateLiquidityV2Manifest;
      finalityLagBlocks: bigint;
      rpcUrl: string;
      fingerprint: string;
    }>;

const required = (env: Readonly<Record<string, unknown>>, key: string): string => {
  const value = env[key];
  if (typeof value !== 'string' || value.length === 0 || value !== value.trim()) {
    throw new Error(`Private Liquidity V2 requires ${key}.`);
  }
  return value;
};

const decimal = (value: string, label: string, maximum = UINT64_MAX): bigint => {
  if (!DECIMAL.test(value)) throw new Error(`${label} must be canonical decimal.`);
  const parsed = BigInt(value);
  if (parsed <= 0n || parsed > maximum) throw new Error(`${label} is out of range.`);
  return parsed;
};

const address = (value: string, label: string): string => {
  let normalized: string;
  try {
    normalized = getAddress(value).toLowerCase();
  } catch {
    throw new Error(`${label} is invalid.`);
  }
  if (normalized === ZERO_ADDRESS) throw new Error(`${label} cannot be zero.`);
  return normalized;
};

const hash = (value: string, label: string): string => {
  const normalized = value.toLowerCase();
  if (!BYTES32.test(normalized) || normalized === ZERO_BYTES32) {
    throw new Error(`${label} must be non-zero bytes32.`);
  }
  return normalized;
};

const rpcUrl = (value: string): string => {
  try {
    const parsed = new URL(value);
    if (parsed.username || parsed.password ||
        (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') ||
        (parsed.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname))) {
      throw new Error('unsupported');
    }
    return parsed.toString();
  } catch {
    throw new Error('Private Liquidity V2 RPC URL must be HTTPS or credential-free local HTTP.');
  }
};

const requireAcceptedHiddenIntentRuntime = (manifest: PrivateLiquidityV2Manifest): void => {
  if (REJECTED_HIDDEN_INTENT_RUNTIME_HASHES.has(manifest.hiddenIntentModule.runtimeBytecodeHash)) {
    throw new Error('Private Liquidity V2 hidden-intent runtime was rejected by live COTI proof.');
  }
};

export const parsePrivateLiquidityV2DeploymentConfig = (
  env: Readonly<Record<string, unknown>>
): PrivateLiquidityV2DeploymentConfig => {
  const enabled = env[PRIVATE_LIQUIDITY_V2_ENV_KEYS.enabled];
  if (enabled === undefined || enabled === '' || enabled === 'false') {
    return Object.freeze({ status: 'inactive' });
  }
  if (enabled !== 'true') {
    throw new Error(`${PRIVATE_LIQUIDITY_V2_ENV_KEYS.enabled} must be exactly true or false.`);
  }
  const chainId = decimal(
    required(env, PRIVATE_LIQUIDITY_V2_ENV_KEYS.chainId),
    'Private Liquidity V2 chain ID',
    (1n << 256n) - 1n
  );
  const bookDeploymentBlock = decimal(
    required(env, PRIVATE_LIQUIDITY_V2_ENV_KEYS.bookDeploymentBlock),
    'Private Liquidity V2 Book deployment block'
  );
  const moduleDeploymentBlock = decimal(
    required(env, PRIVATE_LIQUIDITY_V2_ENV_KEYS.moduleDeploymentBlock),
    'Private Liquidity V2 module deployment block'
  );
  if (moduleDeploymentBlock > bookDeploymentBlock) {
    throw new Error('Private Liquidity V2 module must be deployed no later than its bound Book.');
  }
  const bookAddress = address(
    required(env, PRIVATE_LIQUIDITY_V2_ENV_KEYS.bookAddress),
    'Private Liquidity V2 Book address'
  );
  const moduleAddress = address(
    required(env, PRIVATE_LIQUIDITY_V2_ENV_KEYS.moduleAddress),
    'Private Liquidity V2 module address'
  );
  const positionTokenAddress = address(
    required(env, PRIVATE_LIQUIDITY_V2_ENV_KEYS.positionTokenAddress),
    'Private Liquidity V2 Position NFT address'
  );
  if (new Set([bookAddress, moduleAddress, positionTokenAddress]).size !== 3) {
    throw new Error('Private Liquidity V2 Book, module, and Position NFT addresses must be distinct.');
  }
  const manifest = Object.freeze({
    chainId: chainId.toString(),
    book: Object.freeze({
      address: bookAddress,
      deploymentBlock: bookDeploymentBlock.toString(),
      deploymentBlockHash: hash(
        required(env, PRIVATE_LIQUIDITY_V2_ENV_KEYS.bookDeploymentBlockHash),
        'Private Liquidity V2 Book deployment block hash'
      ),
      creationTransactionHash: hash(
        required(env, PRIVATE_LIQUIDITY_V2_ENV_KEYS.bookCreationTransactionHash),
        'Private Liquidity V2 Book creation transaction hash'
      ),
      runtimeBytecodeHash: hash(
        required(env, PRIVATE_LIQUIDITY_V2_ENV_KEYS.bookRuntimeHash),
        'Private Liquidity V2 Book runtime hash'
      )
    }),
    hiddenIntentModule: Object.freeze({
      address: moduleAddress,
      deploymentBlock: moduleDeploymentBlock.toString(),
      deploymentBlockHash: hash(
        required(env, PRIVATE_LIQUIDITY_V2_ENV_KEYS.moduleDeploymentBlockHash),
        'Private Liquidity V2 module deployment block hash'
      ),
      creationTransactionHash: hash(
        required(env, PRIVATE_LIQUIDITY_V2_ENV_KEYS.moduleCreationTransactionHash),
        'Private Liquidity V2 module creation transaction hash'
      ),
      runtimeBytecodeHash: hash(
        required(env, PRIVATE_LIQUIDITY_V2_ENV_KEYS.moduleRuntimeHash),
        'Private Liquidity V2 module runtime hash'
      )
    }),
    positionToken: Object.freeze({
      address: positionTokenAddress,
      deploymentBlock: bookDeploymentBlock.toString(),
      deploymentBlockHash: hash(
        required(env, PRIVATE_LIQUIDITY_V2_ENV_KEYS.positionTokenDeploymentBlockHash),
        'Private Liquidity V2 Position NFT deployment block hash'
      ),
      creationTransactionHash: hash(
        required(env, PRIVATE_LIQUIDITY_V2_ENV_KEYS.positionTokenCreationTransactionHash),
        'Private Liquidity V2 Position NFT creation transaction hash'
      ),
      runtimeBytecodeHash: hash(
        required(env, PRIVATE_LIQUIDITY_V2_ENV_KEYS.positionTokenRuntimeHash),
        'Private Liquidity V2 Position NFT runtime hash'
      )
    })
  });
  if (manifest.book.deploymentBlockHash !== manifest.positionToken.deploymentBlockHash ||
      manifest.book.creationTransactionHash !== manifest.positionToken.creationTransactionHash) {
    throw new Error('Private Liquidity V2 Position NFT provenance must match its creating Book transaction.');
  }
  requireAcceptedHiddenIntentRuntime(manifest);
  const finalityLagBlocks = decimal(
    required(env, PRIVATE_LIQUIDITY_V2_ENV_KEYS.finalityLagBlocks),
    'Private Liquidity V2 finality lag',
    4_096n
  );
  const resolvedRpcUrl = rpcUrl(required(env, PRIVATE_LIQUIDITY_V2_ENV_KEYS.rpcUrl));
  return Object.freeze({
    status: 'active',
    manifest,
    finalityLagBlocks,
    rpcUrl: resolvedRpcUrl,
    fingerprint: [
      'chainwhisper-private-liquidity-v2',
      manifest.chainId,
      manifest.book.address,
      manifest.book.deploymentBlock,
      manifest.book.deploymentBlockHash,
      manifest.book.creationTransactionHash,
      manifest.book.runtimeBytecodeHash,
      manifest.hiddenIntentModule.address,
      manifest.hiddenIntentModule.deploymentBlock,
      manifest.hiddenIntentModule.deploymentBlockHash,
      manifest.hiddenIntentModule.creationTransactionHash,
      manifest.hiddenIntentModule.runtimeBytecodeHash,
      manifest.positionToken.address,
      manifest.positionToken.deploymentBlockHash,
      manifest.positionToken.creationTransactionHash,
      manifest.positionToken.runtimeBytecodeHash,
      finalityLagBlocks.toString(),
      resolvedRpcUrl
    ].join(':')
  });
};

export const resolvePrivateLiquidityV2DeploymentConfig = (
  env: Readonly<Record<string, unknown>>,
  candidate: TestnetCandidateConfig = resolveTestnetCandidateConfig(env)
): PrivateLiquidityV2DeploymentConfig => {
  if (candidate.status === 'invalid') {
    return Object.freeze({ status: 'invalid', error: 'Private Liquidity V2 testnet candidate is invalid.' });
  }
  if (candidate.status === 'inactive') return Object.freeze({ status: 'inactive' });
  try {
    if (candidate.chainId !== current.chainId || address(candidate.owner, 'Candidate owner') !== current.owner.toLowerCase()) {
      throw new Error('Current Private Liquidity identity differs from candidate admission.');
    }
    const { book, hiddenIntentModule: module, positionToken: nft } = current.manifest;
    return parsePrivateLiquidityV2DeploymentConfig({
      [PRIVATE_LIQUIDITY_V2_ENV_KEYS.enabled]: 'true',
      [PRIVATE_LIQUIDITY_V2_ENV_KEYS.chainId]: current.chainId,
      [PRIVATE_LIQUIDITY_V2_ENV_KEYS.bookAddress]: book.address,
      [PRIVATE_LIQUIDITY_V2_ENV_KEYS.bookDeploymentBlock]: book.deploymentBlock,
      [PRIVATE_LIQUIDITY_V2_ENV_KEYS.bookDeploymentBlockHash]: book.deploymentBlockHash,
      [PRIVATE_LIQUIDITY_V2_ENV_KEYS.bookCreationTransactionHash]: book.creationTransactionHash,
      [PRIVATE_LIQUIDITY_V2_ENV_KEYS.bookRuntimeHash]: book.runtimeBytecodeHash,
      [PRIVATE_LIQUIDITY_V2_ENV_KEYS.moduleAddress]: module.address,
      [PRIVATE_LIQUIDITY_V2_ENV_KEYS.moduleDeploymentBlock]: module.deploymentBlock,
      [PRIVATE_LIQUIDITY_V2_ENV_KEYS.moduleDeploymentBlockHash]: module.deploymentBlockHash,
      [PRIVATE_LIQUIDITY_V2_ENV_KEYS.moduleCreationTransactionHash]: module.creationTransactionHash,
      [PRIVATE_LIQUIDITY_V2_ENV_KEYS.moduleRuntimeHash]: module.runtimeBytecodeHash,
      [PRIVATE_LIQUIDITY_V2_ENV_KEYS.positionTokenAddress]: nft.address,
      [PRIVATE_LIQUIDITY_V2_ENV_KEYS.positionTokenDeploymentBlockHash]: nft.deploymentBlockHash,
      [PRIVATE_LIQUIDITY_V2_ENV_KEYS.positionTokenCreationTransactionHash]: nft.creationTransactionHash,
      [PRIVATE_LIQUIDITY_V2_ENV_KEYS.positionTokenRuntimeHash]: nft.runtimeBytecodeHash,
      [PRIVATE_LIQUIDITY_V2_ENV_KEYS.finalityLagBlocks]: candidate.finalityLagBlocks.toString(),
      [PRIVATE_LIQUIDITY_V2_ENV_KEYS.rpcUrl]: candidate.rpcUrl
    });
  } catch {
    return Object.freeze({
      status: 'invalid',
      error: 'Private Liquidity V2 testnet candidate is invalid.'
    });
  }
};

export const PRIVATE_LIQUIDITY_V2_DEPLOYMENT_CONFIG =
  resolvePrivateLiquidityV2DeploymentConfig(import.meta.env, CHAINWHISPER_TESTNET_CANDIDATE_CONFIG);
