import { getAddress } from '@coti-io/coti-ethers';
import {
  DIRECT_CHAT_V2_DEPLOYMENT_CONFIG,
  type DirectChatV2DeploymentConfig
} from './directChatV2Deployment';
import {
  GROUP_CHAT_V2_DEPLOYMENT_CONFIG,
  type GroupChatV2DeploymentConfig
} from './groupChatV2Deployment';
import {
  CHAINWHISPER_TESTNET_CANDIDATE_CONFIG,
  resolveTestnetCandidateConfig,
  type TestnetCandidateConfig
} from './chainWhisperTestnetCandidate';
import { buildBrowserWalletRuntimeScopeKey } from './browserWalletRuntimeScope';

const DECIMAL_PATTERN = /^(0|[1-9][0-9]*)$/;
const BYTES32_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const ZERO_ADDRESS = `0x${'00'.repeat(20)}`;
const ZERO_BYTES32 = `0x${'00'.repeat(32)}`;

export const CHAT_REACTIONS_V1_ENV_KEYS = Object.freeze({
  enabled: 'VITE_CHAINWHISPER_CHAT_REACTIONS_V1_ENABLED',
  contractAddress: 'VITE_CHAINWHISPER_CHAT_REACTIONS_V1_ADDRESS',
  deploymentBlock: 'VITE_CHAINWHISPER_CHAT_REACTIONS_V1_DEPLOYMENT_BLOCK',
  runtimeBytecodeHash: 'VITE_CHAINWHISPER_CHAT_REACTIONS_V1_RUNTIME_HASH'
} as const);

export type ChatReactionsV1DeploymentConfig =
  | Readonly<{ status: 'inactive' }>
  | Readonly<{ status: 'invalid'; error: string }>
  | Readonly<{
      status: 'active';
      manifest: ChatReactionsV1DeploymentManifest;
      finalityLagBlocks: bigint;
      fingerprint: string;
    }>;

export type ChatReactionsV1DeploymentManifest = Readonly<{
  chainId: bigint;
  contractAddress: string;
  deploymentBlock: bigint;
  runtimeBytecodeHash: string;
  directChatV2: Readonly<{
    contractAddress: string;
    deploymentBlock: bigint;
    runtimeBytecodeHash: string;
  }>;
  groupChatV2: Readonly<{
    contractAddress: string;
    deploymentBlock: bigint;
    runtimeBytecodeHash: string;
  }>;
}>;

export const buildChatReactionsV1RuntimeScopeKey = ({
  activeSignerSource,
  config,
  session,
  walletAddress
}: {
  activeSignerSource: string | null | undefined;
  config: ChatReactionsV1DeploymentConfig;
  session: Readonly<{
    address: string;
    chainId: number | null;
    source?: string;
    walletId: string;
  }> | null;
  walletAddress: string;
}): string | null => {
  if (config.status !== 'active') return null;
  return buildBrowserWalletRuntimeScopeKey({
    activeSignerSource,
    deploymentFingerprint: config.fingerprint,
    expectedChainId: config.manifest.chainId,
    session,
    walletAddress
  });
};

const requiredString = (env: Readonly<Record<string, unknown>>, key: string): string => {
  const value = env[key];
  if (typeof value !== 'string' || value !== value.trim() || value.length === 0) {
    throw new Error(`ChatReactionsV1 requires ${key}.`);
  }
  return value;
};

const target = (
  config: DirectChatV2DeploymentConfig | GroupChatV2DeploymentConfig,
  label: string
) => {
  if (config.status !== 'active') {
    throw new Error(`${label} must have an active frozen deployment before reactions can activate.`);
  }
  return Object.freeze({
    chainId: config.manifest.chainId,
    contractAddress: config.manifest.contractAddress,
    deploymentBlock: config.manifest.deploymentBlock,
    runtimeBytecodeHash: config.manifest.runtimeBytecodeHash,
    finalityLagBlocks: config.finalityLagBlocks
  });
};

export const parseChatReactionsV1DeploymentConfig = (
  env: Readonly<Record<string, unknown>>,
  directConfig: DirectChatV2DeploymentConfig,
  groupConfig: GroupChatV2DeploymentConfig
): ChatReactionsV1DeploymentConfig => {
  const enabled = env[CHAT_REACTIONS_V1_ENV_KEYS.enabled];
  if (enabled === undefined || enabled === '' || enabled === 'false') {
    return Object.freeze({ status: 'inactive' });
  }
  if (enabled !== 'true') {
    throw new Error(`${CHAT_REACTIONS_V1_ENV_KEYS.enabled} must be exactly true or false.`);
  }

  const direct = target(directConfig, 'Direct Chat V2');
  const group = target(groupConfig, 'Group Chat V2');
  if (direct.chainId !== group.chainId) {
    throw new Error('Direct and Group Chat V2 deployments must use the same chain.');
  }

  let contractAddress: string;
  try {
    contractAddress = getAddress(
      requiredString(env, CHAT_REACTIONS_V1_ENV_KEYS.contractAddress)
    ).toLowerCase();
  } catch {
    throw new Error('ChatReactionsV1 deployment address is invalid.');
  }
  if (contractAddress === ZERO_ADDRESS) {
    throw new Error('ChatReactionsV1 deployment address cannot be zero.');
  }

  const deploymentBlockText = requiredString(env, CHAT_REACTIONS_V1_ENV_KEYS.deploymentBlock);
  if (!DECIMAL_PATTERN.test(deploymentBlockText)) {
    throw new Error('ChatReactionsV1 deployment block must be canonical decimal.');
  }
  const deploymentBlock = BigInt(deploymentBlockText);
  if (deploymentBlock <= 0n || deploymentBlock > (1n << 64n) - 1n) {
    throw new Error('ChatReactionsV1 deployment block is out of range.');
  }

  const runtimeBytecodeHash = requiredString(
    env,
    CHAT_REACTIONS_V1_ENV_KEYS.runtimeBytecodeHash
  ).toLowerCase();
  if (!BYTES32_PATTERN.test(runtimeBytecodeHash) || runtimeBytecodeHash === ZERO_BYTES32) {
    throw new Error('ChatReactionsV1 runtime hash must be non-zero bytes32.');
  }

  const manifest = Object.freeze({
    chainId: direct.chainId,
    contractAddress,
    deploymentBlock,
    runtimeBytecodeHash,
    directChatV2: Object.freeze({
      contractAddress: direct.contractAddress,
      deploymentBlock: direct.deploymentBlock,
      runtimeBytecodeHash: direct.runtimeBytecodeHash
    }),
    groupChatV2: Object.freeze({
      contractAddress: group.contractAddress,
      deploymentBlock: group.deploymentBlock,
      runtimeBytecodeHash: group.runtimeBytecodeHash
    })
  });
  const finalityLagBlocks = direct.finalityLagBlocks > group.finalityLagBlocks
    ? direct.finalityLagBlocks
    : group.finalityLagBlocks;
  return Object.freeze({
    status: 'active',
    manifest,
    finalityLagBlocks,
    fingerprint: [
      'chainwhisper-chat-reactions-v1',
      direct.chainId.toString(),
      contractAddress,
      deploymentBlock.toString(),
      runtimeBytecodeHash,
      direct.contractAddress,
      direct.deploymentBlock.toString(),
      direct.runtimeBytecodeHash,
      group.contractAddress,
      group.deploymentBlock.toString(),
      group.runtimeBytecodeHash,
      finalityLagBlocks.toString()
    ].join(':')
  });
};

export const resolveChatReactionsV1DeploymentConfig = (
  env: Readonly<Record<string, unknown>>,
  directConfig: DirectChatV2DeploymentConfig,
  groupConfig: GroupChatV2DeploymentConfig,
  candidate: TestnetCandidateConfig = resolveTestnetCandidateConfig(env)
): ChatReactionsV1DeploymentConfig => {
  if (candidate.status === 'invalid') {
    return Object.freeze({ status: 'invalid', error: 'ChatReactionsV1 testnet candidate is invalid.' });
  }
  if (candidate.status === 'active') {
    const selected = candidate.components.chatReactionsV1;
    const direct = candidate.components.directChatV2;
    const group = candidate.components.groupChatV2;
    if (!selected.deploymentBlock || !direct.deploymentBlock || !group.deploymentBlock ||
        directConfig.status !== 'active' || groupConfig.status !== 'active' ||
        directConfig.manifest.contractAddress !== direct.address ||
        groupConfig.manifest.contractAddress !== group.address) {
      return Object.freeze({ status: 'invalid', error: 'ChatReactionsV1 testnet candidate is invalid.' });
    }
    const manifest = Object.freeze({
      chainId: BigInt(candidate.chainId),
      contractAddress: selected.address,
      deploymentBlock: BigInt(selected.deploymentBlock),
      runtimeBytecodeHash: selected.runtimeBytecodeHash,
      directChatV2: Object.freeze({
        contractAddress: direct.address,
        deploymentBlock: BigInt(direct.deploymentBlock),
        runtimeBytecodeHash: direct.runtimeBytecodeHash
      }),
      groupChatV2: Object.freeze({
        contractAddress: group.address,
        deploymentBlock: BigInt(group.deploymentBlock),
        runtimeBytecodeHash: group.runtimeBytecodeHash
      })
    });
    return Object.freeze({
      status: 'active',
      manifest,
      finalityLagBlocks: candidate.finalityLagBlocks,
      fingerprint: `${candidate.fingerprint}:chat-reactions-v1`
    });
  }
  try {
    return parseChatReactionsV1DeploymentConfig(env, directConfig, groupConfig);
  } catch {
    return Object.freeze({
      status: 'invalid',
      error: 'ChatReactionsV1 deployment configuration is invalid.'
    });
  }
};

export const CHAT_REACTIONS_V1_DEPLOYMENT_CONFIG = resolveChatReactionsV1DeploymentConfig(
  import.meta.env,
  DIRECT_CHAT_V2_DEPLOYMENT_CONFIG,
  GROUP_CHAT_V2_DEPLOYMENT_CONFIG,
  CHAINWHISPER_TESTNET_CANDIDATE_CONFIG
);
