import { describe, expect, it } from 'vitest';
import {
  DIRECT_CHAT_V2_ENV_KEYS,
  parseDirectChatV2DeploymentConfig,
  resolveDirectChatV2DeploymentConfig
} from './directChatV2Deployment';

const address = (pair: string): string => `0x${pair.repeat(20)}`;
const hash = (pair: string): string => `0x${pair.repeat(32)}`;

const activeEnv = (overrides: Readonly<Record<string, unknown>> = {}) => ({
  [DIRECT_CHAT_V2_ENV_KEYS.enabled]: 'true',
  [DIRECT_CHAT_V2_ENV_KEYS.chainId]: '7082400',
  [DIRECT_CHAT_V2_ENV_KEYS.contractAddress]: address('11'),
  [DIRECT_CHAT_V2_ENV_KEYS.deploymentBlock]: '123',
  [DIRECT_CHAT_V2_ENV_KEYS.runtimeBytecodeHash]: hash('22'),
  [DIRECT_CHAT_V2_ENV_KEYS.finalityLagBlocks]: '5',
  [DIRECT_CHAT_V2_ENV_KEYS.rpcUrl]: 'https://testnet.coti.io/rpc',
  ...overrides
});

describe('directChatV2Deployment', () => {
  it('requires exact explicit activation', () => {
    expect(parseDirectChatV2DeploymentConfig({})).toEqual({ status: 'inactive' });
    expect(parseDirectChatV2DeploymentConfig({
      [DIRECT_CHAT_V2_ENV_KEYS.enabled]: 'false',
      [DIRECT_CHAT_V2_ENV_KEYS.contractAddress]: address('11')
    })).toEqual({ status: 'inactive' });
    expect(() => parseDirectChatV2DeploymentConfig({
      [DIRECT_CHAT_V2_ENV_KEYS.enabled]: 'TRUE'
    })).toThrow(/exactly true or false/);
  });

  it('normalizes and fingerprints every public activation field', () => {
    const config = parseDirectChatV2DeploymentConfig(activeEnv());
    expect(config).toEqual({
      status: 'active',
      manifest: {
        chainId: 7_082_400n,
        contractAddress: address('11'),
        deploymentBlock: 123n,
        runtimeBytecodeHash: hash('22')
      },
      finalityLagBlocks: 5n,
      rpcUrl: 'https://testnet.coti.io/rpc',
      fingerprint: [
        'chainwhisper-direct-chat-v2',
        '7082400',
        address('11'),
        '123',
        hash('22'),
        '5',
        'https://testnet.coti.io/rpc'
      ].join(':')
    });
    expect(Object.isFrozen(config)).toBe(true);
    expect(config.status === 'active' && Object.isFrozen(config.manifest)).toBe(true);
  });

  it.each([
    [DIRECT_CHAT_V2_ENV_KEYS.chainId, '0', /chain ID is out of range/],
    [DIRECT_CHAT_V2_ENV_KEYS.chainId, '07', /canonical decimal/],
    [DIRECT_CHAT_V2_ENV_KEYS.contractAddress, address('00'), /cannot be zero/],
    [DIRECT_CHAT_V2_ENV_KEYS.contractAddress, '0x1234', /address is invalid/],
    [DIRECT_CHAT_V2_ENV_KEYS.deploymentBlock, '0', /deployment block is out of range/],
    [DIRECT_CHAT_V2_ENV_KEYS.runtimeBytecodeHash, hash('00'), /non-zero bytes32/],
    [DIRECT_CHAT_V2_ENV_KEYS.finalityLagBlocks, '0', /finality lag is out of range/],
    [DIRECT_CHAT_V2_ENV_KEYS.finalityLagBlocks, '4097', /finality lag is out of range/],
    [DIRECT_CHAT_V2_ENV_KEYS.rpcUrl, 'http://example.com', /RPC URL must be HTTPS/],
    [DIRECT_CHAT_V2_ENV_KEYS.rpcUrl, 'https://user:secret@example.com', /RPC URL must be HTTPS/]
  ])('rejects malformed active field %s', (key, value, expected) => {
    expect(() => parseDirectChatV2DeploymentConfig(activeEnv({ [key]: value })))
      .toThrow(expected as RegExp);
  });

  it('fails closed when enabled configuration is incomplete', () => {
    for (const key of Object.values(DIRECT_CHAT_V2_ENV_KEYS).filter(
      (key) => key !== DIRECT_CHAT_V2_ENV_KEYS.enabled
    )) {
      const env = activeEnv();
      delete env[key as keyof typeof env];
      expect(() => parseDirectChatV2DeploymentConfig(env)).toThrow(key);
    }
    expect(resolveDirectChatV2DeploymentConfig({
      [DIRECT_CHAT_V2_ENV_KEYS.enabled]: 'true'
    })).toEqual({
      status: 'invalid',
      error: 'Direct Chat V2 deployment configuration is invalid.'
    });
  });
});
