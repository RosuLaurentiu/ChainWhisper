import { getAddress } from '@coti-io/coti-ethers';
import {
  CHAINWHISPER_TESTNET_CANDIDATE_CONFIG,
  resolveTestnetCandidateConfig,
  type TestnetCandidateConfig
} from './chainWhisperTestnetCandidate';

const DECIMAL_PATTERN = /^(0|[1-9][0-9]*)$/;
const BYTES32_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const ZERO_ADDRESS = `0x${'00'.repeat(20)}`;
const ZERO_BYTES32 = `0x${'00'.repeat(32)}`;

export const GROUP_CHAT_V2_ENV_KEYS = Object.freeze({
  enabled: 'VITE_CHAINWHISPER_GROUP_CHAT_V2_ENABLED',
  chainId: 'VITE_CHAINWHISPER_GROUP_CHAT_V2_CHAIN_ID',
  contractAddress: 'VITE_CHAINWHISPER_GROUP_CHAT_V2_ADDRESS',
  deploymentBlock: 'VITE_CHAINWHISPER_GROUP_CHAT_V2_DEPLOYMENT_BLOCK',
  runtimeBytecodeHash: 'VITE_CHAINWHISPER_GROUP_CHAT_V2_RUNTIME_HASH',
  finalityLagBlocks: 'VITE_CHAINWHISPER_GROUP_CHAT_V2_FINALITY_LAG_BLOCKS',
  rpcUrl: 'VITE_CHAINWHISPER_GROUP_CHAT_V2_RPC_URL'
} as const);

export type GroupChatV2DeploymentManifest = Readonly<{
  chainId: bigint;
  contractAddress: string;
  deploymentBlock: bigint;
  runtimeBytecodeHash: string;
}>;

export type GroupChatV2DeploymentConfig =
  | Readonly<{ status: 'inactive' }>
  | Readonly<{ status: 'invalid'; error: string }>
  | Readonly<{
      status: 'active';
      manifest: GroupChatV2DeploymentManifest;
      finalityLagBlocks: bigint;
      rpcUrl: string;
      fingerprint: string;
    }>;

const requiredString = (env: Readonly<Record<string, unknown>>, key: string): string => {
  const value = env[key];
  if (typeof value !== 'string' || value !== value.trim() || value.length === 0) {
    throw new Error(`Group Chat V2 requires ${key}.`);
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

export const parseGroupChatV2DeploymentConfig = (
  env: Readonly<Record<string, unknown>>
): GroupChatV2DeploymentConfig => {
  const enabled = env[GROUP_CHAT_V2_ENV_KEYS.enabled];
  if (enabled === undefined || enabled === '' || enabled === 'false') {
    return Object.freeze({ status: 'inactive' });
  }
  if (enabled !== 'true') {
    throw new Error(`${GROUP_CHAT_V2_ENV_KEYS.enabled} must be exactly true or false.`);
  }

  const chainId = positiveDecimal(
    requiredString(env, GROUP_CHAT_V2_ENV_KEYS.chainId),
    'Group Chat V2 chain ID'
  );
  const deploymentBlock = positiveDecimal(
    requiredString(env, GROUP_CHAT_V2_ENV_KEYS.deploymentBlock),
    'Group Chat V2 deployment block',
    (1n << 64n) - 1n
  );
  const finalityLagBlocks = positiveDecimal(
    requiredString(env, GROUP_CHAT_V2_ENV_KEYS.finalityLagBlocks),
    'Group Chat V2 finality lag',
    4_096n
  );

  let contractAddress: string;
  try {
    contractAddress = getAddress(
      requiredString(env, GROUP_CHAT_V2_ENV_KEYS.contractAddress)
    ).toLowerCase();
  } catch {
    throw new Error('Group Chat V2 deployment address is invalid.');
  }
  if (contractAddress === ZERO_ADDRESS) {
    throw new Error('Group Chat V2 deployment address cannot be zero.');
  }

  const runtimeBytecodeHash = requiredString(
    env,
    GROUP_CHAT_V2_ENV_KEYS.runtimeBytecodeHash
  ).toLowerCase();
  if (!BYTES32_PATTERN.test(runtimeBytecodeHash) || runtimeBytecodeHash === ZERO_BYTES32) {
    throw new Error('Group Chat V2 runtime hash must be non-zero bytes32.');
  }

  let rpcUrl: string;
  try {
    const parsed = new URL(requiredString(env, GROUP_CHAT_V2_ENV_KEYS.rpcUrl));
    if (
      (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') ||
      parsed.username ||
      parsed.password ||
      (parsed.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname))
    ) {
      throw new Error('unsupported');
    }
    rpcUrl = parsed.toString();
  } catch {
    throw new Error('Group Chat V2 RPC URL must be HTTPS or a credential-free local HTTP URL.');
  }

  const manifest = Object.freeze({
    chainId,
    contractAddress,
    deploymentBlock,
    runtimeBytecodeHash
  });
  return Object.freeze({
    status: 'active',
    manifest,
    finalityLagBlocks,
    rpcUrl,
    fingerprint: [
      'chainwhisper-group-chat-v2',
      chainId.toString(),
      contractAddress,
      deploymentBlock.toString(),
      runtimeBytecodeHash,
      finalityLagBlocks.toString(),
      rpcUrl
    ].join(':')
  });
};

export const resolveGroupChatV2DeploymentConfig = (
  env: Readonly<Record<string, unknown>>,
  candidate: TestnetCandidateConfig = resolveTestnetCandidateConfig(env)
): GroupChatV2DeploymentConfig => {
  if (candidate.status === 'invalid') {
    return Object.freeze({ status: 'invalid', error: 'Group Chat V2 testnet candidate is invalid.' });
  }
  if (candidate.status === 'active') {
    const selected = candidate.components.groupChatV2;
    if (!selected.deploymentBlock) {
      return Object.freeze({ status: 'invalid', error: 'Group Chat V2 testnet candidate is invalid.' });
    }
    const manifest = Object.freeze({
      chainId: BigInt(candidate.chainId),
      contractAddress: selected.address,
      deploymentBlock: BigInt(selected.deploymentBlock),
      runtimeBytecodeHash: selected.runtimeBytecodeHash
    });
    return Object.freeze({
      status: 'active',
      manifest,
      finalityLagBlocks: candidate.finalityLagBlocks,
      rpcUrl: candidate.rpcUrl,
      fingerprint: `${candidate.fingerprint}:group-chat-v2`
    });
  }
  try {
    return parseGroupChatV2DeploymentConfig(env);
  } catch {
    return Object.freeze({
      status: 'invalid',
      error: 'Group Chat V2 deployment configuration is invalid.'
    });
  }
};

export const GROUP_CHAT_V2_DEPLOYMENT_CONFIG =
  resolveGroupChatV2DeploymentConfig(import.meta.env, CHAINWHISPER_TESTNET_CANDIDATE_CONFIG);
