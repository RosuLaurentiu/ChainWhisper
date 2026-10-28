import { getAddress } from '@coti-io/coti-ethers';
import { PRIVATE_LIQUIDITY_V2_DEPLOYMENT_CONFIG } from './privateLiquidityV2Deployment';

const DECIMAL = /^(0|[1-9][0-9]*)$/;
const BYTES32 = /^0x[0-9a-fA-F]{64}$/;
const ZERO_ADDRESS = `0x${'00'.repeat(20)}`;
const ZERO_BYTES32 = `0x${'00'.repeat(32)}`;

export const PRIVATE_LIQUIDITY_DAILY_PRICE_ENV_KEYS = Object.freeze({
  enabled: 'VITE_CHAINWHISPER_PRIVATE_LIQUIDITY_DAILY_PRICE_ENABLED',
  address: 'VITE_CHAINWHISPER_PRIVATE_LIQUIDITY_DAILY_PRICE_ADDRESS',
  deploymentBlock: 'VITE_CHAINWHISPER_PRIVATE_LIQUIDITY_DAILY_PRICE_DEPLOYMENT_BLOCK',
  deploymentBlockHash: 'VITE_CHAINWHISPER_PRIVATE_LIQUIDITY_DAILY_PRICE_DEPLOYMENT_BLOCK_HASH',
  transactionHash: 'VITE_CHAINWHISPER_PRIVATE_LIQUIDITY_DAILY_PRICE_TRANSACTION_HASH',
  runtimeHash: 'VITE_CHAINWHISPER_PRIVATE_LIQUIDITY_DAILY_PRICE_RUNTIME_HASH',
  owner: 'VITE_CHAINWHISPER_PRIVATE_LIQUIDITY_DAILY_PRICE_OWNER',
  recorder: 'VITE_CHAINWHISPER_PRIVATE_LIQUIDITY_DAILY_PRICE_RECORDER'
} as const);

export type PrivateLiquidityDailyPriceManifest = Readonly<{
  chainId: string;
  address: string;
  deploymentBlock: string;
  deploymentBlockHash: string;
  transactionHash: string;
  runtimeBytecodeHash: string;
  owner: string;
  recorder: string;
  sourceBook: string;
  sourceBookRuntimeHash: string;
}>;

export type PrivateLiquidityDailyPriceDeploymentConfig =
  | Readonly<{ status: 'inactive' }>
  | Readonly<{ status: 'invalid'; error: string }>
  | Readonly<{
      status: 'active';
      manifest: PrivateLiquidityDailyPriceManifest;
      finalityLagBlocks: bigint;
      rpcUrl: string;
      fingerprint: string;
    }>;

const required = (env: Readonly<Record<string, unknown>>, key: string): string => {
  const value = env[key];
  if (typeof value !== 'string' || value.length === 0 || value !== value.trim()) {
    throw new Error(`Daily marginal-price store requires ${key}.`);
  }
  return value;
};

const address = (value: string): string => {
  let normalized: string;
  try {
    normalized = getAddress(value).toLowerCase();
  } catch {
    throw new Error('Daily marginal-price store address is invalid.');
  }
  if (normalized === ZERO_ADDRESS) throw new Error('Daily marginal-price store address cannot be zero.');
  return normalized;
};

const blockNumber = (value: string): string => {
  if (!DECIMAL.test(value) || BigInt(value) === 0n || BigInt(value) >= (1n << 64n)) {
    throw new Error('Daily marginal-price store deployment block is invalid.');
  }
  return BigInt(value).toString();
};

const hash = (value: string): string => {
  const normalized = value.toLowerCase();
  if (!BYTES32.test(normalized) || normalized === ZERO_BYTES32) {
    throw new Error('Daily marginal-price store runtime hash is invalid.');
  }
  return normalized;
};

export const resolvePrivateLiquidityDailyPriceDeploymentConfig = (
  env: Readonly<Record<string, unknown>>,
  liquidityConfig = PRIVATE_LIQUIDITY_V2_DEPLOYMENT_CONFIG
): PrivateLiquidityDailyPriceDeploymentConfig => {
  const enabled = env[PRIVATE_LIQUIDITY_DAILY_PRICE_ENV_KEYS.enabled];
  if (enabled === undefined || enabled === '' || enabled === 'false') {
    return Object.freeze({ status: 'inactive' });
  }
  if (enabled !== 'true') {
    return Object.freeze({ status: 'invalid', error: 'Daily marginal-price activation flag is invalid.' });
  }
  if (liquidityConfig.status !== 'active') {
    return Object.freeze({ status: 'invalid', error: 'Daily marginal-price store requires an active reviewed Private Liquidity V2 Book.' });
  }
  try {
    const storeAddress = address(required(env, PRIVATE_LIQUIDITY_DAILY_PRICE_ENV_KEYS.address));
    if (storeAddress === liquidityConfig.manifest.book.address) {
      throw new Error('Daily marginal-price store must be separate from the Private Liquidity Book.');
    }
    const storeDeploymentBlock = blockNumber(required(env, PRIVATE_LIQUIDITY_DAILY_PRICE_ENV_KEYS.deploymentBlock));
    if (BigInt(storeDeploymentBlock) < BigInt(liquidityConfig.manifest.book.deploymentBlock)) {
      throw new Error('Daily marginal-price store cannot predate its source Book.');
    }
    const manifest = Object.freeze({
      chainId: liquidityConfig.manifest.chainId,
      address: storeAddress,
      deploymentBlock: storeDeploymentBlock,
      deploymentBlockHash: hash(required(env, PRIVATE_LIQUIDITY_DAILY_PRICE_ENV_KEYS.deploymentBlockHash)),
      transactionHash: hash(required(env, PRIVATE_LIQUIDITY_DAILY_PRICE_ENV_KEYS.transactionHash)),
      runtimeBytecodeHash: hash(required(env, PRIVATE_LIQUIDITY_DAILY_PRICE_ENV_KEYS.runtimeHash)),
      owner: address(required(env, PRIVATE_LIQUIDITY_DAILY_PRICE_ENV_KEYS.owner)),
      recorder: address(required(env, PRIVATE_LIQUIDITY_DAILY_PRICE_ENV_KEYS.recorder)),
      sourceBook: liquidityConfig.manifest.book.address,
      sourceBookRuntimeHash: liquidityConfig.manifest.book.runtimeBytecodeHash
    });
    if (
      manifest.owner === manifest.recorder ||
      manifest.owner === manifest.address ||
      manifest.owner === manifest.sourceBook ||
      manifest.recorder === manifest.address ||
      manifest.recorder === manifest.sourceBook
    ) {
      throw new Error('Daily marginal-price authority identities must remain separate.');
    }
    return Object.freeze({
      status: 'active',
      manifest,
      finalityLagBlocks: liquidityConfig.finalityLagBlocks,
      rpcUrl: liquidityConfig.rpcUrl,
      fingerprint: [
        'chainwhisper-private-liquidity-daily-price-v1',
        manifest.chainId,
        manifest.address,
        manifest.deploymentBlock,
        manifest.deploymentBlockHash,
        manifest.transactionHash,
        manifest.runtimeBytecodeHash,
        manifest.owner,
        manifest.recorder,
        manifest.sourceBook,
        manifest.sourceBookRuntimeHash,
        liquidityConfig.finalityLagBlocks.toString()
      ].join(':')
    });
  } catch {
    return Object.freeze({ status: 'invalid', error: 'Daily marginal-price store deployment configuration is invalid.' });
  }
};

export const PRIVATE_LIQUIDITY_DAILY_PRICE_DEPLOYMENT_CONFIG =
  resolvePrivateLiquidityDailyPriceDeploymentConfig(import.meta.env);
