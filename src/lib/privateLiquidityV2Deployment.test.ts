import { describe, expect, it } from 'vitest';
import {
  PRIVATE_LIQUIDITY_V2_ENV_KEYS,
  parsePrivateLiquidityV2DeploymentConfig,
  resolvePrivateLiquidityV2DeploymentConfig
} from './privateLiquidityV2Deployment';

const address = (pair: string): string => `0x${pair.repeat(20)}`;
const hash = (pair: string): string => `0x${pair.repeat(32)}`;

const activeEnv = (overrides: Readonly<Record<string, unknown>> = {}) => ({
  [PRIVATE_LIQUIDITY_V2_ENV_KEYS.enabled]: 'true',
  [PRIVATE_LIQUIDITY_V2_ENV_KEYS.chainId]: '7082400',
  [PRIVATE_LIQUIDITY_V2_ENV_KEYS.bookAddress]: address('11'),
  [PRIVATE_LIQUIDITY_V2_ENV_KEYS.bookDeploymentBlock]: '125',
  [PRIVATE_LIQUIDITY_V2_ENV_KEYS.bookDeploymentBlockHash]: hash('13'),
  [PRIVATE_LIQUIDITY_V2_ENV_KEYS.bookCreationTransactionHash]: hash('14'),
  [PRIVATE_LIQUIDITY_V2_ENV_KEYS.bookRuntimeHash]: hash('12'),
  [PRIVATE_LIQUIDITY_V2_ENV_KEYS.moduleAddress]: address('21'),
  [PRIVATE_LIQUIDITY_V2_ENV_KEYS.moduleDeploymentBlock]: '123',
  [PRIVATE_LIQUIDITY_V2_ENV_KEYS.moduleDeploymentBlockHash]: hash('23'),
  [PRIVATE_LIQUIDITY_V2_ENV_KEYS.moduleCreationTransactionHash]: hash('24'),
  [PRIVATE_LIQUIDITY_V2_ENV_KEYS.moduleRuntimeHash]: hash('22'),
  [PRIVATE_LIQUIDITY_V2_ENV_KEYS.positionTokenAddress]: address('31'),
  [PRIVATE_LIQUIDITY_V2_ENV_KEYS.positionTokenDeploymentBlockHash]: hash('13'),
  [PRIVATE_LIQUIDITY_V2_ENV_KEYS.positionTokenCreationTransactionHash]: hash('14'),
  [PRIVATE_LIQUIDITY_V2_ENV_KEYS.positionTokenRuntimeHash]: hash('32'),
  [PRIVATE_LIQUIDITY_V2_ENV_KEYS.finalityLagBlocks]: '5',
  [PRIVATE_LIQUIDITY_V2_ENV_KEYS.rpcUrl]: 'https://testnet.coti.io/rpc',
  ...overrides
});

describe('privateLiquidityV2Deployment', () => {
  it('stays inactive unless activation is exact and explicit', () => {
    expect(parsePrivateLiquidityV2DeploymentConfig({})).toEqual({ status: 'inactive' });
    expect(parsePrivateLiquidityV2DeploymentConfig({
      [PRIVATE_LIQUIDITY_V2_ENV_KEYS.enabled]: 'false'
    })).toEqual({ status: 'inactive' });
    expect(() => parsePrivateLiquidityV2DeploymentConfig({
      [PRIVATE_LIQUIDITY_V2_ENV_KEYS.enabled]: 'TRUE'
    })).toThrow(/exactly true or false/);
  });

  it('normalizes and fingerprints the complete three-contract manifest', () => {
    const config = parsePrivateLiquidityV2DeploymentConfig(activeEnv());
    expect(config).toEqual({
      status: 'active',
      manifest: {
        chainId: '7082400',
        book: {
          address: address('11'),
          deploymentBlock: '125',
          deploymentBlockHash: hash('13'),
          creationTransactionHash: hash('14'),
          runtimeBytecodeHash: hash('12')
        },
        hiddenIntentModule: {
          address: address('21'),
          deploymentBlock: '123',
          deploymentBlockHash: hash('23'),
          creationTransactionHash: hash('24'),
          runtimeBytecodeHash: hash('22')
        },
        positionToken: {
          address: address('31'),
          deploymentBlock: '125',
          deploymentBlockHash: hash('13'),
          creationTransactionHash: hash('14'),
          runtimeBytecodeHash: hash('32')
        }
      },
      finalityLagBlocks: 5n,
      rpcUrl: 'https://testnet.coti.io/rpc',
      fingerprint: [
        'chainwhisper-private-liquidity-v2',
        '7082400',
        address('11'),
        '125',
        hash('13'),
        hash('14'),
        hash('12'),
        address('21'),
        '123',
        hash('23'),
        hash('24'),
        hash('22'),
        address('31'),
        hash('13'),
        hash('14'),
        hash('32'),
        '5',
        'https://testnet.coti.io/rpc'
      ].join(':')
    });
    expect(Object.isFrozen(config)).toBe(true);
    expect(config.status === 'active' && Object.isFrozen(config.manifest.book)).toBe(true);
  });

  it.each([
    [PRIVATE_LIQUIDITY_V2_ENV_KEYS.chainId, '0', /chain ID is out of range/],
    [PRIVATE_LIQUIDITY_V2_ENV_KEYS.chainId, '07', /canonical decimal/],
    [PRIVATE_LIQUIDITY_V2_ENV_KEYS.bookAddress, address('00'), /cannot be zero/],
    [PRIVATE_LIQUIDITY_V2_ENV_KEYS.moduleAddress, '0x1234', /module address is invalid/],
    [PRIVATE_LIQUIDITY_V2_ENV_KEYS.bookDeploymentBlock, '0', /Book deployment block is out of range/],
    [PRIVATE_LIQUIDITY_V2_ENV_KEYS.bookDeploymentBlockHash, hash('00'), /non-zero bytes32/],
    [PRIVATE_LIQUIDITY_V2_ENV_KEYS.moduleCreationTransactionHash, '0x1234', /non-zero bytes32/],
    [PRIVATE_LIQUIDITY_V2_ENV_KEYS.moduleRuntimeHash, hash('00'), /non-zero bytes32/],
    [PRIVATE_LIQUIDITY_V2_ENV_KEYS.finalityLagBlocks, '0', /finality lag is out of range/],
    [PRIVATE_LIQUIDITY_V2_ENV_KEYS.finalityLagBlocks, '4097', /finality lag is out of range/],
    [PRIVATE_LIQUIDITY_V2_ENV_KEYS.rpcUrl, 'http://example.com', /RPC URL must be HTTPS/],
    [PRIVATE_LIQUIDITY_V2_ENV_KEYS.rpcUrl, 'https://user:secret@example.com', /RPC URL must be HTTPS/]
  ])('rejects malformed active manifest field %s', (key, value, expected) => {
    expect(() => parsePrivateLiquidityV2DeploymentConfig(activeEnv({ [key]: value })))
      .toThrow(expected as RegExp);
  });

  it('rejects impossible deployment relationships and address aliasing', () => {
    expect(() => parsePrivateLiquidityV2DeploymentConfig(activeEnv({
      [PRIVATE_LIQUIDITY_V2_ENV_KEYS.moduleDeploymentBlock]: '126'
    }))).toThrow(/module must be deployed no later/);
    expect(() => parsePrivateLiquidityV2DeploymentConfig(activeEnv({
      [PRIVATE_LIQUIDITY_V2_ENV_KEYS.positionTokenAddress]: address('11')
    }))).toThrow(/addresses must be distinct/);
    expect(resolvePrivateLiquidityV2DeploymentConfig(activeEnv({
      [PRIVATE_LIQUIDITY_V2_ENV_KEYS.positionTokenCreationTransactionHash]: hash('99')
    }), {
      status: 'active',
      chainId: '7082400',
      owner: address('41'),
      components: {
        privateLiquidityBookV2: { address: address('11'), deploymentBlock: '125', runtimeBytecodeHash: hash('12') },
        privateLiquidityHiddenIntentV2: { address: address('21'), deploymentBlock: '123', runtimeBytecodeHash: hash('22') },
        privateLiquidityPositionNftV2: { address: address('31'), deploymentBlock: '125', runtimeBytecodeHash: hash('32') }
      },
      finalityLagBlocks: 5n,
      rpcUrl: 'https://testnet.coti.io/rpc',
      fingerprint: 'candidate'
    } as never)).toEqual({
      status: 'invalid',
      error: 'Private Liquidity V2 testnet candidate is invalid.'
    });
  });

  it('rejects the hidden-intent runtime disproven by the live COTI journey', () => {
    expect(() => parsePrivateLiquidityV2DeploymentConfig(activeEnv({
      [PRIVATE_LIQUIDITY_V2_ENV_KEYS.moduleRuntimeHash]:
        '0xb67819b84429775d5456868941edc4e61203b1bde1a8e27433bf19922df7601f'
    }))).toThrow(/rejected by live COTI proof/);
  });

  it('fails closed when an enabled manifest is incomplete', () => {
    for (const key of Object.values(PRIVATE_LIQUIDITY_V2_ENV_KEYS)
      .filter((key) => key !== PRIVATE_LIQUIDITY_V2_ENV_KEYS.enabled)) {
      const env = activeEnv();
      delete env[key as keyof typeof env];
      expect(() => parsePrivateLiquidityV2DeploymentConfig(env)).toThrow(key);
    }
    expect(resolvePrivateLiquidityV2DeploymentConfig({
      [PRIVATE_LIQUIDITY_V2_ENV_KEYS.enabled]: 'true'
    })).toEqual({
      status: 'invalid',
      error: 'Private Liquidity V2 deployment configuration is invalid.'
    });
  });
});
