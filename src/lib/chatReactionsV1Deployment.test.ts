import { describe, expect, it } from 'vitest';
import {
  buildChatReactionsV1RuntimeScopeKey,
  CHAT_REACTIONS_V1_ENV_KEYS,
  parseChatReactionsV1DeploymentConfig,
  resolveChatReactionsV1DeploymentConfig
} from './chatReactionsV1Deployment';

const direct = {
  status: 'active' as const,
  manifest: {
    chainId: 7_082_400n,
    contractAddress: '0x1111111111111111111111111111111111111111',
    deploymentBlock: 100n,
    runtimeBytecodeHash: `0x${'11'.repeat(32)}`
  },
  finalityLagBlocks: 8n,
  rpcUrl: 'https://example.test/',
  fingerprint: 'direct'
};
const group = {
  status: 'active' as const,
  manifest: {
    chainId: 7_082_400n,
    contractAddress: '0x2222222222222222222222222222222222222222',
    deploymentBlock: 200n,
    runtimeBytecodeHash: `0x${'22'.repeat(32)}`
  },
  finalityLagBlocks: 12n,
  rpcUrl: 'https://example.test/',
  fingerprint: 'group'
};
const env = {
  [CHAT_REACTIONS_V1_ENV_KEYS.enabled]: 'true',
  [CHAT_REACTIONS_V1_ENV_KEYS.contractAddress]: '0x3333333333333333333333333333333333333333',
  [CHAT_REACTIONS_V1_ENV_KEYS.deploymentBlock]: '300',
  [CHAT_REACTIONS_V1_ENV_KEYS.runtimeBytecodeHash]: `0x${'33'.repeat(32)}`
};

describe('ChatReactionsV1 deployment configuration', () => {
  it('stays inactive without exposing partial deployment values', () => {
    expect(parseChatReactionsV1DeploymentConfig({}, direct, group)).toEqual({ status: 'inactive' });
    expect(parseChatReactionsV1DeploymentConfig({
      [CHAT_REACTIONS_V1_ENV_KEYS.enabled]: 'false',
      [CHAT_REACTIONS_V1_ENV_KEYS.contractAddress]: env[CHAT_REACTIONS_V1_ENV_KEYS.contractAddress]
    }, direct, group)).toEqual({ status: 'inactive' });
  });

  it('composes one frozen manifest from the exact active Direct and Group deployments', () => {
    const config = parseChatReactionsV1DeploymentConfig(env, direct, group);
    expect(config).toMatchObject({
      status: 'active',
      finalityLagBlocks: 12n,
      manifest: {
        chainId: 7_082_400n,
        contractAddress: '0x3333333333333333333333333333333333333333',
        deploymentBlock: 300n,
        directChatV2: {
          contractAddress: direct.manifest.contractAddress,
          deploymentBlock: direct.manifest.deploymentBlock,
          runtimeBytecodeHash: direct.manifest.runtimeBytecodeHash
        },
        groupChatV2: {
          contractAddress: group.manifest.contractAddress,
          deploymentBlock: group.manifest.deploymentBlock,
          runtimeBytecodeHash: group.manifest.runtimeBytecodeHash
        }
      }
    });
    expect(Object.isFrozen(config)).toBe(true);
    expect(config.status === 'active' && Object.isFrozen(config.manifest)).toBe(true);
  });

  it('fails closed for target, chain, or own-deployment substitutions', () => {
    expect(() => parseChatReactionsV1DeploymentConfig(env, { status: 'inactive' }, group))
      .toThrow(/Direct Chat V2/);
    expect(() => parseChatReactionsV1DeploymentConfig(env, direct, {
      ...group,
      manifest: { ...group.manifest, chainId: 1n }
    })).toThrow(/same chain/);
    expect(() => parseChatReactionsV1DeploymentConfig({
      ...env,
      [CHAT_REACTIONS_V1_ENV_KEYS.runtimeBytecodeHash]: `0x${'00'.repeat(32)}`
    }, direct, group)).toThrow(/runtime hash/);
    expect(resolveChatReactionsV1DeploymentConfig({
      ...env,
      [CHAT_REACTIONS_V1_ENV_KEYS.deploymentBlock]: '0300'
    }, direct, group)).toEqual({
      status: 'invalid',
      error: 'ChatReactionsV1 deployment configuration is invalid.'
    });
  });

  it('keeps one runtime identity across equivalent committed wallet-session wrappers', () => {
    const config = parseChatReactionsV1DeploymentConfig(env, direct, group);
    const input = {
      activeSignerSource: 'metamask',
      config,
      session: {
        address: '0x4444444444444444444444444444444444444444',
        chainId: 7_082_400,
        source: 'injected',
        walletId: 'metamask'
      },
      walletAddress: '0x4444444444444444444444444444444444444444'
    } as const;

    const first = buildChatReactionsV1RuntimeScopeKey(input);
    const equivalent = buildChatReactionsV1RuntimeScopeKey({
      ...input,
      session: { ...input.session }
    });
    expect(first).not.toBeNull();
    expect(equivalent).toBe(first);
  });

  it('retires runtime identity for a real owner, wallet-source, or committed-chain change', () => {
    const config = parseChatReactionsV1DeploymentConfig(env, direct, group);
    const base = {
      activeSignerSource: 'metamask',
      config,
      session: {
        address: '0x4444444444444444444444444444444444444444',
        chainId: 7_082_400,
        source: 'injected',
        walletId: 'metamask'
      },
      walletAddress: '0x4444444444444444444444444444444444444444'
    } as const;
    expect(buildChatReactionsV1RuntimeScopeKey({ ...base, activeSignerSource: null })).toBeNull();
    expect(buildChatReactionsV1RuntimeScopeKey({
      ...base,
      session: { ...base.session, chainId: 1 }
    })).toBeNull();
    expect(buildChatReactionsV1RuntimeScopeKey({
      ...base,
      walletAddress: '0x5555555555555555555555555555555555555555'
    })).toBeNull();
  });
});
