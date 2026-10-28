import { getAddress } from '@coti-io/coti-ethers';
import type { PrivateLiquidityManifestInput } from './privateLiquidityChain';

const DECIMAL_PATTERN = /^(0|[1-9][0-9]*)$/;
const BYTES32_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const ZERO_BYTES32 = `0x${'00'.repeat(32)}`;

export const PRIVATE_LIQUIDITY_ENV_KEYS = Object.freeze({
  enabled: 'VITE_CHAINWHISPER_PRIVATE_LIQUIDITY_V1_ENABLED',
  chainId: 'VITE_CHAINWHISPER_PRIVATE_LIQUIDITY_V1_CHAIN_ID',
  contractAddress: 'VITE_CHAINWHISPER_PRIVATE_LIQUIDITY_V1_ADDRESS',
  deploymentBlock: 'VITE_CHAINWHISPER_PRIVATE_LIQUIDITY_V1_DEPLOYMENT_BLOCK',
  runtimeBytecodeHash: 'VITE_CHAINWHISPER_PRIVATE_LIQUIDITY_V1_RUNTIME_HASH',
  finalityLagBlocks: 'VITE_CHAINWHISPER_PRIVATE_LIQUIDITY_V1_FINALITY_LAG_BLOCKS',
  rpcUrl: 'VITE_CHAINWHISPER_PRIVATE_LIQUIDITY_V1_RPC_URL'
} as const);

export type InactivePrivateLiquidityDeploymentConfig = Readonly<{
  status: 'inactive';
}>;

export type InvalidPrivateLiquidityDeploymentConfig = Readonly<{
  status: 'invalid';
  error: string;
}>;

export type ActivePrivateLiquidityDeploymentConfig = Readonly<{
  status: 'active';
  manifest: PrivateLiquidityManifestInput & Readonly<{
    chainId: string;
    contractAddress: string;
    deploymentBlock: string;
    runtimeBytecodeHash: string;
  }>;
  finalityLagBlocks: bigint;
  rpcUrl: string;
  fingerprint: string;
}>;

export type PrivateLiquidityDeploymentConfig =
  | InactivePrivateLiquidityDeploymentConfig
  | InvalidPrivateLiquidityDeploymentConfig
  | ActivePrivateLiquidityDeploymentConfig;

const requiredString = (
  env: Readonly<Record<string, unknown>>,
  key: string
): string => {
  const value = env[key];
  if (typeof value !== 'string' || value !== value.trim() || value.length === 0) {
    throw new Error(`Private Liquidity V1 requires ${key}.`);
  }
  return value;
};

const positiveDecimal = (value: string, label: string, maximum?: bigint): bigint => {
  if (!DECIMAL_PATTERN.test(value)) throw new Error(`${label} must be canonical decimal.`);
  const parsed = BigInt(value);
  if (parsed <= 0n || (maximum !== undefined && parsed > maximum)) {
    throw new Error(`${label} is out of range.`);
  }
  return parsed;
};

export const parsePrivateLiquidityDeploymentConfig = (
  env: Readonly<Record<string, unknown>>
): PrivateLiquidityDeploymentConfig => {
  const enabled = env[PRIVATE_LIQUIDITY_ENV_KEYS.enabled];
  if (enabled === undefined || enabled === '' || enabled === 'false') {
    return Object.freeze({ status: 'inactive' });
  }
  if (enabled !== 'true') {
    throw new Error(`${PRIVATE_LIQUIDITY_ENV_KEYS.enabled} must be exactly true or false.`);
  }
  const chainId = positiveDecimal(
    requiredString(env, PRIVATE_LIQUIDITY_ENV_KEYS.chainId),
    'Private-liquidity deployment chain ID'
  );
  const deploymentBlock = positiveDecimal(
    requiredString(env, PRIVATE_LIQUIDITY_ENV_KEYS.deploymentBlock),
    'Private-liquidity deployment block',
    (1n << 64n) - 1n
  );
  const finalityLagBlocks = positiveDecimal(
    requiredString(env, PRIVATE_LIQUIDITY_ENV_KEYS.finalityLagBlocks),
    'Private-liquidity finality lag',
    4_096n
  );
  let contractAddress: string;
  const configuredAddress = requiredString(env, PRIVATE_LIQUIDITY_ENV_KEYS.contractAddress);
  try {
    contractAddress = getAddress(configuredAddress).toLowerCase();
  } catch {
    throw new Error('Private-liquidity deployment address is invalid.');
  }
  if (contractAddress === `0x${'00'.repeat(20)}`) {
    throw new Error('Private-liquidity deployment address cannot be zero.');
  }
  const runtimeBytecodeHash = requiredString(
    env,
    PRIVATE_LIQUIDITY_ENV_KEYS.runtimeBytecodeHash
  ).toLowerCase();
  if (!BYTES32_PATTERN.test(runtimeBytecodeHash) || runtimeBytecodeHash === ZERO_BYTES32) {
    throw new Error('Private-liquidity runtime hash must be non-zero bytes32.');
  }
  let rpcUrl: string;
  const configuredRpcUrl = requiredString(env, PRIVATE_LIQUIDITY_ENV_KEYS.rpcUrl);
  try {
    const parsed = new URL(configuredRpcUrl);
    if ((parsed.protocol !== 'https:' && parsed.protocol !== 'http:') || parsed.username || parsed.password) {
      throw new Error('unsupported');
    }
    if (parsed.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)) {
      throw new Error('insecure');
    }
    rpcUrl = parsed.toString();
  } catch {
    throw new Error('Private-liquidity RPC URL must be HTTPS or a credential-free local HTTP URL.');
  }
  const manifest = Object.freeze({
    chainId: chainId.toString(),
    contractAddress,
    deploymentBlock: deploymentBlock.toString(),
    runtimeBytecodeHash
  });
  return Object.freeze({
    status: 'active',
    manifest,
    finalityLagBlocks,
    rpcUrl,
    fingerprint: [
      'chainwhisper-private-liquidity-v1',
      manifest.chainId,
      manifest.contractAddress,
      manifest.deploymentBlock,
      manifest.runtimeBytecodeHash,
      finalityLagBlocks.toString(),
      rpcUrl
    ].join(':')
  });
};

export const resolvePrivateLiquidityDeploymentConfig = (
  env: Readonly<Record<string, unknown>>
): PrivateLiquidityDeploymentConfig => {
  try {
    return parsePrivateLiquidityDeploymentConfig(env);
  } catch {
    return Object.freeze({
      status: 'invalid',
      error: 'Private Liquidity V1 deployment configuration is invalid.'
    });
  }
};

export const PRIVATE_LIQUIDITY_DEPLOYMENT_CONFIG =
  resolvePrivateLiquidityDeploymentConfig(import.meta.env);
