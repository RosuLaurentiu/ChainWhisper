import { describe, expect, it } from 'vitest';
import type { PrivateLiquidityV2DeploymentConfig } from './privateLiquidityV2Deployment';
import {
  PRIVATE_LIQUIDITY_DAILY_PRICE_ENV_KEYS,
  resolvePrivateLiquidityDailyPriceDeploymentConfig
} from './privateLiquidityDailyPriceDeployment';

const address = (pair: string) => `0x${pair.repeat(20)}`;
const hash = (pair: string) => `0x${pair.repeat(32)}`;
const liquidityConfig: PrivateLiquidityV2DeploymentConfig = Object.freeze({
  status: 'active',
  manifest: Object.freeze({
    chainId: '7082400',
    book: Object.freeze({
      address: address('11'), deploymentBlock: '100', deploymentBlockHash: hash('13'),
      creationTransactionHash: hash('14'), runtimeBytecodeHash: hash('12')
    }),
    hiddenIntentModule: Object.freeze({
      address: address('21'), deploymentBlock: '99', deploymentBlockHash: hash('23'),
      creationTransactionHash: hash('24'), runtimeBytecodeHash: hash('22')
    }),
    positionToken: Object.freeze({
      address: address('31'), deploymentBlock: '100', deploymentBlockHash: hash('13'),
      creationTransactionHash: hash('14'), runtimeBytecodeHash: hash('32')
    })
  }),
  finalityLagBlocks: 5n,
  rpcUrl: 'https://testnet.coti.io/rpc',
  fingerprint: 'private-liquidity-test'
});

describe('privateLiquidityDailyPriceDeployment', () => {
  it('stays inactive unless the separate analytics store is explicitly enabled', () => {
    expect(resolvePrivateLiquidityDailyPriceDeploymentConfig({}, liquidityConfig)).toEqual({ status: 'inactive' });
  });

  it('binds the store to the exact reviewed source Book and shared finality policy', () => {
    const config = resolvePrivateLiquidityDailyPriceDeploymentConfig({
      [PRIVATE_LIQUIDITY_DAILY_PRICE_ENV_KEYS.enabled]: 'true',
      [PRIVATE_LIQUIDITY_DAILY_PRICE_ENV_KEYS.address]: address('41'),
      [PRIVATE_LIQUIDITY_DAILY_PRICE_ENV_KEYS.deploymentBlock]: '120',
      [PRIVATE_LIQUIDITY_DAILY_PRICE_ENV_KEYS.deploymentBlockHash]: hash('43'),
      [PRIVATE_LIQUIDITY_DAILY_PRICE_ENV_KEYS.transactionHash]: hash('44'),
      [PRIVATE_LIQUIDITY_DAILY_PRICE_ENV_KEYS.runtimeHash]: hash('42'),
      [PRIVATE_LIQUIDITY_DAILY_PRICE_ENV_KEYS.owner]: address('51'),
      [PRIVATE_LIQUIDITY_DAILY_PRICE_ENV_KEYS.recorder]: address('61')
    }, liquidityConfig);
    expect(config).toMatchObject({
      status: 'active',
      manifest: {
        chainId: '7082400',
        address: address('41'),
        deploymentBlock: '120',
        deploymentBlockHash: hash('43'),
        transactionHash: hash('44'),
        runtimeBytecodeHash: hash('42'),
        owner: address('51'),
        recorder: address('61'),
        sourceBook: address('11'),
        sourceBookRuntimeHash: hash('12')
      },
      finalityLagBlocks: 5n,
      rpcUrl: 'https://testnet.coti.io/rpc'
    });
  });

  it('rejects missing or aliased owner and recorder authorities', () => {
    const base = {
      [PRIVATE_LIQUIDITY_DAILY_PRICE_ENV_KEYS.enabled]: 'true',
      [PRIVATE_LIQUIDITY_DAILY_PRICE_ENV_KEYS.address]: address('41'),
      [PRIVATE_LIQUIDITY_DAILY_PRICE_ENV_KEYS.deploymentBlock]: '120',
      [PRIVATE_LIQUIDITY_DAILY_PRICE_ENV_KEYS.deploymentBlockHash]: hash('43'),
      [PRIVATE_LIQUIDITY_DAILY_PRICE_ENV_KEYS.transactionHash]: hash('44'),
      [PRIVATE_LIQUIDITY_DAILY_PRICE_ENV_KEYS.runtimeHash]: hash('42'),
      [PRIVATE_LIQUIDITY_DAILY_PRICE_ENV_KEYS.owner]: address('51')
    };
    expect(resolvePrivateLiquidityDailyPriceDeploymentConfig(base, liquidityConfig).status).toBe('invalid');
    expect(resolvePrivateLiquidityDailyPriceDeploymentConfig({
      ...base,
      [PRIVATE_LIQUIDITY_DAILY_PRICE_ENV_KEYS.recorder]: address('51')
    }, liquidityConfig).status).toBe('invalid');
    expect(resolvePrivateLiquidityDailyPriceDeploymentConfig({
      ...base,
      [PRIVATE_LIQUIDITY_DAILY_PRICE_ENV_KEYS.recorder]: address('11')
    }, liquidityConfig).status).toBe('invalid');
  });

  it('fails closed without an active Book or with an aliased/malformed store', () => {
    expect(resolvePrivateLiquidityDailyPriceDeploymentConfig({
      [PRIVATE_LIQUIDITY_DAILY_PRICE_ENV_KEYS.enabled]: 'true'
    }, { status: 'inactive' })).toEqual({
      status: 'invalid',
      error: 'Daily marginal-price store requires an active reviewed Private Liquidity V2 Book.'
    });
    expect(resolvePrivateLiquidityDailyPriceDeploymentConfig({
      [PRIVATE_LIQUIDITY_DAILY_PRICE_ENV_KEYS.enabled]: 'true',
      [PRIVATE_LIQUIDITY_DAILY_PRICE_ENV_KEYS.address]: address('11'),
      [PRIVATE_LIQUIDITY_DAILY_PRICE_ENV_KEYS.deploymentBlock]: '120',
      [PRIVATE_LIQUIDITY_DAILY_PRICE_ENV_KEYS.deploymentBlockHash]: hash('43'),
      [PRIVATE_LIQUIDITY_DAILY_PRICE_ENV_KEYS.transactionHash]: hash('44'),
      [PRIVATE_LIQUIDITY_DAILY_PRICE_ENV_KEYS.runtimeHash]: hash('42')
    }, liquidityConfig).status).toBe('invalid');
    expect(resolvePrivateLiquidityDailyPriceDeploymentConfig({
      [PRIVATE_LIQUIDITY_DAILY_PRICE_ENV_KEYS.enabled]: 'true',
      [PRIVATE_LIQUIDITY_DAILY_PRICE_ENV_KEYS.address]: address('41'),
      [PRIVATE_LIQUIDITY_DAILY_PRICE_ENV_KEYS.deploymentBlock]: '99',
      [PRIVATE_LIQUIDITY_DAILY_PRICE_ENV_KEYS.deploymentBlockHash]: hash('43'),
      [PRIVATE_LIQUIDITY_DAILY_PRICE_ENV_KEYS.transactionHash]: hash('44'),
      [PRIVATE_LIQUIDITY_DAILY_PRICE_ENV_KEYS.runtimeHash]: hash('42')
    }, liquidityConfig).status).toBe('invalid');
  });
});
