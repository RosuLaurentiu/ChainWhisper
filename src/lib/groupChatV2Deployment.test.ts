import { describe, expect, it } from 'vitest';
import {
  GROUP_CHAT_V2_ENV_KEYS,
  parseGroupChatV2DeploymentConfig,
  resolveGroupChatV2DeploymentConfig
} from './groupChatV2Deployment';

const activeEnv = (): Record<string, string> => ({
  [GROUP_CHAT_V2_ENV_KEYS.enabled]: 'true',
  [GROUP_CHAT_V2_ENV_KEYS.chainId]: '7082400',
  [GROUP_CHAT_V2_ENV_KEYS.contractAddress]: '0x1111111111111111111111111111111111111111',
  [GROUP_CHAT_V2_ENV_KEYS.deploymentBlock]: '8948000',
  [GROUP_CHAT_V2_ENV_KEYS.runtimeBytecodeHash]: `0x${'ab'.repeat(32)}`,
  [GROUP_CHAT_V2_ENV_KEYS.finalityLagBlocks]: '12',
  [GROUP_CHAT_V2_ENV_KEYS.rpcUrl]: 'https://testnet.coti.io/rpc'
});

describe('Group Chat V2 deployment configuration', () => {
  it('is inactive by default and only enables from the exact literal true', () => {
    expect(parseGroupChatV2DeploymentConfig({})).toEqual({ status: 'inactive' });
    expect(parseGroupChatV2DeploymentConfig({ [GROUP_CHAT_V2_ENV_KEYS.enabled]: 'false' }))
      .toEqual({ status: 'inactive' });
    expect(() => parseGroupChatV2DeploymentConfig({
      [GROUP_CHAT_V2_ENV_KEYS.enabled]: 'TRUE'
    })).toThrow('exactly true or false');
  });

  it('parses and freezes one complete testnet manifest', () => {
    const config = parseGroupChatV2DeploymentConfig(activeEnv());
    expect(config.status).toBe('active');
    if (config.status !== 'active') throw new Error('Expected active config.');
    expect(config.manifest).toEqual({
      chainId: 7_082_400n,
      contractAddress: '0x1111111111111111111111111111111111111111',
      deploymentBlock: 8_948_000n,
      runtimeBytecodeHash: `0x${'ab'.repeat(32)}`
    });
    expect(config.finalityLagBlocks).toBe(12n);
    expect(config.rpcUrl).toBe('https://testnet.coti.io/rpc');
    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.manifest)).toBe(true);
    expect(config.fingerprint).toContain('chainwhisper-group-chat-v2:7082400');
  });

  it.each([
    [GROUP_CHAT_V2_ENV_KEYS.chainId, '07082400'],
    [GROUP_CHAT_V2_ENV_KEYS.chainId, '0'],
    [GROUP_CHAT_V2_ENV_KEYS.deploymentBlock, '-1'],
    [GROUP_CHAT_V2_ENV_KEYS.finalityLagBlocks, '0'],
    [GROUP_CHAT_V2_ENV_KEYS.finalityLagBlocks, '4097'],
    [GROUP_CHAT_V2_ENV_KEYS.contractAddress, '0x0000000000000000000000000000000000000000'],
    [GROUP_CHAT_V2_ENV_KEYS.runtimeBytecodeHash, `0x${'00'.repeat(32)}`],
    [GROUP_CHAT_V2_ENV_KEYS.rpcUrl, 'http://example.com/rpc'],
    [GROUP_CHAT_V2_ENV_KEYS.rpcUrl, 'https://user:pass@example.com/rpc']
  ])('rejects unsafe %s configuration', (key, value) => {
    expect(() => parseGroupChatV2DeploymentConfig({ ...activeEnv(), [key]: value })).toThrow();
  });

  it('allows credential-free local HTTP for an isolated development node', () => {
    const config = parseGroupChatV2DeploymentConfig({
      ...activeEnv(),
      [GROUP_CHAT_V2_ENV_KEYS.rpcUrl]: 'http://127.0.0.1:8545'
    });
    expect(config.status === 'active' && config.rpcUrl).toBe('http://127.0.0.1:8545/');
  });

  it('returns one non-diagnostic invalid state for production callers', () => {
    expect(resolveGroupChatV2DeploymentConfig({
      ...activeEnv(),
      [GROUP_CHAT_V2_ENV_KEYS.runtimeBytecodeHash]: 'bad'
    })).toEqual({
      status: 'invalid',
      error: 'Group Chat V2 deployment configuration is invalid.'
    });
  });
});
