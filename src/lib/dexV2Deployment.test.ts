import { describe, expect, it } from 'vitest';
import { AbiCoder, keccak256 } from '@coti-io/coti-ethers';
import {
  DEX_V2_COMPONENT_KEYS,
  DEX_V2_ENV_KEYS,
  hashDexV2AppManifestBody,
  parseDexV2DeploymentConfig,
  resolveDexV2DeploymentConfig
} from './dexV2Deployment';

const address = (byte: number): string => `0x${byte.toString(16).padStart(2, '0').repeat(20)}`;
const hash = (byte: number): string => `0x${byte.toString(16).padStart(2, '0').repeat(32)}`;
const pairKey = (baseToken: string, quoteToken: string): string =>
  keccak256(AbiCoder.defaultAbiCoder().encode(['address', 'address'], [baseToken, quoteToken])).toLowerCase();

const manifest = (mutate?: (body: Record<string, any>) => void): string => {
  const addresses = Object.fromEntries(DEX_V2_COMPONENT_KEYS.map((key, index) => [key, address(index + 1)]));
  const runtimeHashes = Object.fromEntries(DEX_V2_COMPONENT_KEYS.map((key, index) => [key, hash(index + 1)]));
  const body: Record<string, any> = {
    schemaVersion: 1,
    status: 'activated-testnet',
    network: 'cotiTestnet',
    chainId: '7082400',
    productionActivationEvidence: false,
    operator: address(59),
    owner: address(60),
    deploymentPlanHash: hash(20),
    deploymentCandidateHash: hash(21),
    activationPlanHash: hash(22),
    activationReportHash: hash(23),
    addresses,
    runtimeHashes,
    deploymentAnchors: {
      factory: { number: '100', hash: hash(30) },
      economicSuite: { number: '105', hash: hash(31) },
      pairRegistration: { number: '110', hash: hash(32) }
    },
    pair: {
      baseToken: address(40),
      quoteToken: address(41),
      pairKey: pairKey(address(40), address(41)),
      baseTokenRuntimeHash: hash(41),
      quoteTokenRuntimeHash: hash(41),
      privateTokenRuntimeManifestHash: hash(43),
      privateTokenRuntimeManifestLength: 1,
      baseDecimals: 6,
      quoteDecimals: 6,
      baseLotSize: '100',
      quoteLotSize: '100',
      maximumAggregateLots: '2000000',
      tickTableHash: hash(42)
    },
    activation: {
      result: 'pass',
      transactionCount: 16,
      measuredRouteCount: 4,
      finalBlock: { number: '150', hash: hash(50) },
      allProofsPassed: true,
      routeGasP95Passed: true,
      routeGasMaximumPassed: true,
      routeLatencyP95Passed: true
    }
  };
  mutate?.(body);
  return JSON.stringify({ ...body, manifestHash: hashDexV2AppManifestBody(body) });
};

const env = (overrides: Readonly<Record<string, unknown>> = {}) => ({
  [DEX_V2_ENV_KEYS.enabled]: 'true',
  [DEX_V2_ENV_KEYS.manifest]: manifest(),
  [DEX_V2_ENV_KEYS.finalityLagBlocks]: '5',
  [DEX_V2_ENV_KEYS.rpcUrl]: 'https://testnet.coti.io/rpc',
  ...overrides
});

describe('dexV2Deployment', () => {
  it('remains inactive until explicitly enabled', () => {
    expect(parseDexV2DeploymentConfig({})).toEqual({ status: 'inactive' });
    expect(parseDexV2DeploymentConfig({ [DEX_V2_ENV_KEYS.enabled]: 'false' }))
      .toEqual({ status: 'inactive' });
    expect(() => parseDexV2DeploymentConfig({ [DEX_V2_ENV_KEYS.enabled]: 'TRUE' }))
      .toThrow(/exactly true or false/);
  });

  it('accepts only an activation-pass manifest and fingerprints all release anchors', () => {
    const config = parseDexV2DeploymentConfig(env());
    expect(config.status).toBe('active');
    if (config.status !== 'active') throw new Error('expected active');
    expect(config.manifest.chainId).toBe('7082400');
    expect(config.manifest.activation).toMatchObject({
      result: 'pass',
      transactionCount: 16,
      measuredRouteCount: 4,
      allProofsPassed: true
    });
    expect(config.fingerprint).toContain(config.manifest.activationReportHash);
    expect(Object.isFrozen(config.manifest.addresses)).toBe(true);
    expect(Object.isFrozen(config.manifest.pair)).toBe(true);
  });

  it.each([
    ['candidate deployed but activation pending', (body: Record<string, any>) => { body.status = 'deployment-ready-activation-pending'; }],
    ['semantic-only recovery result', (body: Record<string, any>) => { body.activation.result = 'semantic-pass-performance-incomplete'; }],
    ['failed route gate', (body: Record<string, any>) => { body.activation.routeGasP95Passed = false; }],
    ['wrong transaction count', (body: Record<string, any>) => { body.activation.transactionCount = 15; }],
    ['production overclaim', (body: Record<string, any>) => { body.productionActivationEvidence = true; }]
  ])('rejects %s', (_label, mutate) => {
    expect(() => parseDexV2DeploymentConfig(env({
      [DEX_V2_ENV_KEYS.manifest]: manifest(mutate)
    }))).toThrow();
  });

  it('rejects manifest tampering, aliased addresses, bad pair ordering, and block-order drift', () => {
    const tampered = JSON.parse(manifest());
    tampered.pair.baseLotSize = '101';
    expect(() => parseDexV2DeploymentConfig(env({
      [DEX_V2_ENV_KEYS.manifest]: JSON.stringify(tampered)
    }))).toThrow(/manifest hash/);
    expect(() => parseDexV2DeploymentConfig(env({
      [DEX_V2_ENV_KEYS.manifest]: manifest((body) => {
        body.addresses.limit = body.addresses.pool;
      })
    }))).toThrow(/distinct/);
    expect(() => parseDexV2DeploymentConfig(env({
      [DEX_V2_ENV_KEYS.manifest]: manifest((body) => {
        [body.pair.baseToken, body.pair.quoteToken] = [body.pair.quoteToken, body.pair.baseToken];
      })
    }))).toThrow(/canonical address order/);
    expect(() => parseDexV2DeploymentConfig(env({
      [DEX_V2_ENV_KEYS.manifest]: manifest((body) => {
        body.pair.pairKey = hash(40);
      })
    }))).toThrow(/pair key/);
    expect(() => parseDexV2DeploymentConfig(env({
      [DEX_V2_ENV_KEYS.manifest]: manifest((body) => {
        body.deploymentAnchors.economicSuite.number = '99';
      })
    }))).toThrow(/out of order/);
  });

  it('fails closed for incomplete enabled configuration and unsafe RPC input', () => {
    expect(resolveDexV2DeploymentConfig({ [DEX_V2_ENV_KEYS.enabled]: 'true' })).toEqual({
      status: 'invalid',
      error: 'ChainWhisper DEX V2 deployment configuration is invalid.'
    });
    expect(() => parseDexV2DeploymentConfig(env({
      [DEX_V2_ENV_KEYS.rpcUrl]: 'https://user:secret@testnet.coti.io/rpc'
    }))).toThrow(/credential-free/);
    expect(() => parseDexV2DeploymentConfig(env({
      [DEX_V2_ENV_KEYS.finalityLagBlocks]: '0'
    }))).toThrow(/out of range/);
  });
});
