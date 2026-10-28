import { describe, expect, it } from 'vitest';
import {
  PRIVATE_LIQUIDITY_ENV_KEYS,
  parsePrivateLiquidityDeploymentConfig,
  resolvePrivateLiquidityDeploymentConfig
} from './privateLiquidityDeployment';

const address = (pair: string): string => `0x${pair.repeat(20)}`;
const hash = (pair: string): string => `0x${pair.repeat(32)}`;

const activeEnv = (overrides: Readonly<Record<string, unknown>> = {}) => ({
  [PRIVATE_LIQUIDITY_ENV_KEYS.enabled]: 'true',
  [PRIVATE_LIQUIDITY_ENV_KEYS.chainId]: '7082400',
  [PRIVATE_LIQUIDITY_ENV_KEYS.contractAddress]: address('11'),
  [PRIVATE_LIQUIDITY_ENV_KEYS.deploymentBlock]: '123',
  [PRIVATE_LIQUIDITY_ENV_KEYS.runtimeBytecodeHash]: hash('22'),
  [PRIVATE_LIQUIDITY_ENV_KEYS.finalityLagBlocks]: '5',
  [PRIVATE_LIQUIDITY_ENV_KEYS.rpcUrl]: 'https://testnet.coti.io/rpc',
  ...overrides
});

describe('privateLiquidityDeployment', () => {
  it('is inactive unless activation is exact and explicit', () => {
    expect(parsePrivateLiquidityDeploymentConfig({})).toEqual({ status: 'inactive' });
    expect(parsePrivateLiquidityDeploymentConfig({
      [PRIVATE_LIQUIDITY_ENV_KEYS.enabled]: 'false',
      [PRIVATE_LIQUIDITY_ENV_KEYS.contractAddress]: address('11')
    })).toEqual({ status: 'inactive' });
    expect(() => parsePrivateLiquidityDeploymentConfig({
      [PRIVATE_LIQUIDITY_ENV_KEYS.enabled]: 'TRUE'
    })).toThrow(/exactly true or false/);
  });

  it('normalizes and fingerprints the complete public manifest', () => {
    const config = parsePrivateLiquidityDeploymentConfig(activeEnv());
    expect(config).toEqual({
      status: 'active',
      manifest: {
        chainId: '7082400',
        contractAddress: address('11'),
        deploymentBlock: '123',
        runtimeBytecodeHash: hash('22')
      },
      finalityLagBlocks: 5n,
      rpcUrl: 'https://testnet.coti.io/rpc',
      fingerprint: [
        'chainwhisper-private-liquidity-v1',
        '7082400',
        address('11'),
        '123',
        hash('22'),
        '5',
        'https://testnet.coti.io/rpc'
      ].join(':')
    });
    expect(Object.isFrozen(config)).toBe(true);
  });

  it.each([
    [PRIVATE_LIQUIDITY_ENV_KEYS.chainId, '0', /chain ID is out of range/],
    [PRIVATE_LIQUIDITY_ENV_KEYS.chainId, '07', /canonical decimal/],
    [PRIVATE_LIQUIDITY_ENV_KEYS.contractAddress, address('00'), /cannot be zero/],
    [PRIVATE_LIQUIDITY_ENV_KEYS.contractAddress, '0x1234', /address is invalid/],
    [PRIVATE_LIQUIDITY_ENV_KEYS.deploymentBlock, '0', /deployment block is out of range/],
    [PRIVATE_LIQUIDITY_ENV_KEYS.runtimeBytecodeHash, hash('00'), /non-zero bytes32/],
    [PRIVATE_LIQUIDITY_ENV_KEYS.finalityLagBlocks, '0', /finality lag is out of range/],
    [PRIVATE_LIQUIDITY_ENV_KEYS.finalityLagBlocks, '4097', /finality lag is out of range/],
    [PRIVATE_LIQUIDITY_ENV_KEYS.rpcUrl, 'http://example.com', /RPC URL must be HTTPS/],
    [PRIVATE_LIQUIDITY_ENV_KEYS.rpcUrl, 'https://user:secret@example.com', /RPC URL must be HTTPS/]
  ])('rejects malformed active manifest field %s', (key, value, expected) => {
    expect(() => parsePrivateLiquidityDeploymentConfig(activeEnv({ [key]: value })))
      .toThrow(expected as RegExp);
  });

  it('fails closed when any enabled manifest field is missing', () => {
    for (const key of Object.values(PRIVATE_LIQUIDITY_ENV_KEYS).filter((key) => key !== PRIVATE_LIQUIDITY_ENV_KEYS.enabled)) {
      const env = activeEnv();
      delete env[key as keyof typeof env];
      expect(() => parsePrivateLiquidityDeploymentConfig(env)).toThrow(key);
    }
    expect(resolvePrivateLiquidityDeploymentConfig({
      [PRIVATE_LIQUIDITY_ENV_KEYS.enabled]: 'true'
    })).toEqual({
      status: 'invalid',
      error: 'Private Liquidity V1 deployment configuration is invalid.'
    });
  });
});
