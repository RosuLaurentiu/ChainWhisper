import { getAddress } from '@coti-io/coti-ethers';
import { OTC_V2_DEPLOYMENT_CATALOG, resolveOtcV2DeploymentCatalog, type OtcV2DeploymentCatalog } from './otcV2DeploymentCatalog';
import type { TradeHistoryV2ManifestInput } from './tradeHistoryV2Chain';
import type { CurrentP2PDirectAdmission } from './currentP2PBinding';
import {
  CHAINWHISPER_TESTNET_CANDIDATE_CONFIG,
  resolveTestnetCandidateConfig,
  type TestnetCandidateConfig
} from './chainWhisperTestnetCandidate';

const DECIMAL_PATTERN = /^(0|[1-9][0-9]*)$/;
const BYTES32_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const ZERO_BYTES32 = `0x${'00'.repeat(32)}`;

export const DIRECT_TRADE_V2_ENV_KEYS = Object.freeze({
  enabled: 'VITE_CHAINWHISPER_DIRECT_TRADE_V2_ENABLED',
  chainId: 'VITE_CHAINWHISPER_DIRECT_TRADE_V2_CHAIN_ID',
  contractAddress: 'VITE_CHAINWHISPER_DIRECT_TRADE_V2_ADDRESS',
  deploymentBlock: 'VITE_CHAINWHISPER_DIRECT_TRADE_V2_DEPLOYMENT_BLOCK',
  runtimeBytecodeHash: 'VITE_CHAINWHISPER_DIRECT_TRADE_V2_RUNTIME_HASH',
  finalityLagBlocks: 'VITE_CHAINWHISPER_DIRECT_TRADE_V2_FINALITY_LAG_BLOCKS',
  rpcUrl: 'VITE_CHAINWHISPER_DIRECT_TRADE_V2_RPC_URL'
} as const);

type DirectTradeV2Manifest = TradeHistoryV2ManifestInput & Readonly<{
  protocol: 'direct-v2';
  chainId: string;
  contractAddress: string;
  deploymentBlock: string;
  runtimeBytecodeHash: string;
}>;

export type DirectTradeV2DeploymentConfig =
  | Readonly<{ status: 'inactive' }>
  | Readonly<{ status: 'invalid'; error: string }>
  | Readonly<{
      status: 'active';
      manifest: DirectTradeV2Manifest;
      finalityLagBlocks: bigint;
      rpcUrl: string;
      fingerprint: string;
      retainedManifests?: readonly DirectTradeV2Manifest[];
      actionAdmission?: CurrentP2PDirectAdmission;
    }>;

const requiredString = (env: Readonly<Record<string, unknown>>, key: string): string => {
  const value = env[key];
  if (typeof value !== 'string' || value !== value.trim() || value.length === 0) {
    throw new Error(`Direct Trade V2 requires ${key}.`);
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

export const parseDirectTradeV2DeploymentConfig = (
  env: Readonly<Record<string, unknown>>
): DirectTradeV2DeploymentConfig => {
  const enabled = env[DIRECT_TRADE_V2_ENV_KEYS.enabled];
  if (enabled === undefined || enabled === '' || enabled === 'false') {
    return Object.freeze({ status: 'inactive' });
  }
  if (enabled !== 'true') {
    throw new Error(`${DIRECT_TRADE_V2_ENV_KEYS.enabled} must be exactly true or false.`);
  }
  const chainId = positiveDecimal(
    requiredString(env, DIRECT_TRADE_V2_ENV_KEYS.chainId),
    'Direct Trade V2 chain ID'
  );
  const deploymentBlock = positiveDecimal(
    requiredString(env, DIRECT_TRADE_V2_ENV_KEYS.deploymentBlock),
    'Direct Trade V2 deployment block',
    (1n << 64n) - 1n
  );
  const finalityLagBlocks = positiveDecimal(
    requiredString(env, DIRECT_TRADE_V2_ENV_KEYS.finalityLagBlocks),
    'Direct Trade V2 finality lag',
    4_096n
  );
  let contractAddress: string;
  const configuredAddress = requiredString(env, DIRECT_TRADE_V2_ENV_KEYS.contractAddress);
  try {
    contractAddress = getAddress(configuredAddress).toLowerCase();
  } catch {
    throw new Error('Direct Trade V2 deployment address is invalid.');
  }
  if (contractAddress === `0x${'00'.repeat(20)}`) {
    throw new Error('Direct Trade V2 deployment address cannot be zero.');
  }
  const runtimeBytecodeHash = requiredString(
    env,
    DIRECT_TRADE_V2_ENV_KEYS.runtimeBytecodeHash
  ).toLowerCase();
  if (!BYTES32_PATTERN.test(runtimeBytecodeHash) || runtimeBytecodeHash === ZERO_BYTES32) {
    throw new Error('Direct Trade V2 runtime hash must be non-zero bytes32.');
  }
  let rpcUrl: string;
  const configuredRpcUrl = requiredString(env, DIRECT_TRADE_V2_ENV_KEYS.rpcUrl);
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
    throw new Error('Direct Trade V2 RPC URL must be HTTPS or a credential-free local HTTP URL.');
  }
  const manifest = Object.freeze({
    protocol: 'direct-v2' as const,
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
      'chainwhisper-direct-trade-v2',
      manifest.chainId,
      manifest.contractAddress,
      manifest.deploymentBlock,
      manifest.runtimeBytecodeHash,
      finalityLagBlocks.toString(),
      rpcUrl
    ].join(':')
  });
};

export const resolveDirectTradeV2DeploymentConfig = (
  env: Readonly<Record<string, unknown>>,
  candidate: TestnetCandidateConfig = resolveTestnetCandidateConfig(env),
  catalog: OtcV2DeploymentCatalog = resolveOtcV2DeploymentCatalog(candidate)
): DirectTradeV2DeploymentConfig => {
  if (candidate.status === 'invalid') {
    return Object.freeze({ status: 'invalid', error: 'Direct Trade V2 testnet candidate is invalid.' });
  }
  if (candidate.status === 'active') {
    if (catalog.status !== 'active' || catalog.chainId !== candidate.chainId) {
      return Object.freeze({ status: 'invalid', error: 'Direct Trade V2 testnet candidate is invalid.' });
    }
    const manifest = catalog.deployments['direct-v2'].manifest;
    const retained = catalog.preparedP2p?.retainedDeployments['direct-v2'].manifest;
    if (manifest.protocol !== 'direct-v2' || (retained && retained.protocol !== 'direct-v2')) {
      return Object.freeze({ status: 'invalid', error: 'Direct Trade V2 deployment protocol is invalid.' });
    }
    return Object.freeze({
      status: 'active',
      manifest: manifest as DirectTradeV2Manifest,
      finalityLagBlocks: catalog.finalityLagBlocks,
      rpcUrl: catalog.rpcUrl,
      fingerprint: `${catalog.fingerprint}:direct-trade-v2`,
      ...(catalog.preparedP2p ? { actionAdmission: catalog.preparedP2p.directAdmission } : {}),
      ...(retained && retained.contractAddress !== manifest.contractAddress
        ? { retainedManifests: Object.freeze([retained as DirectTradeV2Manifest]) } : {})
    });
  }
  try {
    return parseDirectTradeV2DeploymentConfig(env);
  } catch {
    return Object.freeze({
      status: 'invalid',
      error: 'Direct Trade V2 deployment configuration is invalid.'
    });
  }
};

export const DIRECT_TRADE_V2_DEPLOYMENT_CONFIG =
  resolveDirectTradeV2DeploymentConfig(import.meta.env, CHAINWHISPER_TESTNET_CANDIDATE_CONFIG, OTC_V2_DEPLOYMENT_CATALOG);

export const DIRECT_TRADE_V2_SUPPORTED_CONTRACTS = DIRECT_TRADE_V2_DEPLOYMENT_CONFIG.status === 'active'
  ? Object.freeze([DIRECT_TRADE_V2_DEPLOYMENT_CONFIG.manifest.contractAddress, ...(DIRECT_TRADE_V2_DEPLOYMENT_CONFIG.retainedManifests ?? []).map(item => item.contractAddress)]) : undefined;

export const isSupportedDirectTradeV2Escrow = (address: string, contracts?: readonly string[], single?: string): boolean =>
  contracts ? contracts.some(value => value.toLowerCase() === address.toLowerCase()) : !single || single.toLowerCase() === address.toLowerCase();
