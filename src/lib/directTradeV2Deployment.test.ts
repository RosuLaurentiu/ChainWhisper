import { describe, expect, it } from 'vitest';
import {
  DIRECT_TRADE_V2_ENV_KEYS,
  parseDirectTradeV2DeploymentConfig,
  resolveDirectTradeV2DeploymentConfig
} from './directTradeV2Deployment';
import { resolveOtcV2DeploymentCatalog } from './otcV2DeploymentCatalog';
import { CURRENT_P2P_BINDING } from './currentP2PBinding';

const address = (pair: string): string => `0x${pair.repeat(20)}`;
const hash = (pair: string): string => `0x${pair.repeat(32)}`;

const ACTIVE = {
  [DIRECT_TRADE_V2_ENV_KEYS.enabled]: 'true',
  [DIRECT_TRADE_V2_ENV_KEYS.chainId]: '7082400',
  [DIRECT_TRADE_V2_ENV_KEYS.contractAddress]: address('11'),
  [DIRECT_TRADE_V2_ENV_KEYS.deploymentBlock]: '123',
  [DIRECT_TRADE_V2_ENV_KEYS.runtimeBytecodeHash]: hash('22'),
  [DIRECT_TRADE_V2_ENV_KEYS.finalityLagBlocks]: '5',
  [DIRECT_TRADE_V2_ENV_KEYS.rpcUrl]: 'https://testnet.coti.io/rpc'
};

describe('directTradeV2Deployment', () => {
  it('uses the same admitted Direct selection as OTC and keeps the old Direct manifest', () => {
    const components = Object.fromEntries(['standardOtcV2', 'privateOtcV2', 'directOtcV2', 'recurringOtcV2', 'private-recurringOtcV2'].map((key, i) => [key,
      { address: address(String(i + 1).repeat(2)), deploymentBlock: '123', runtimeBytecodeHash: hash('22') }]));
    const candidate = { status: 'active', chainId: '7082400', components, finalityLagBlocks: 5n, rpcUrl: 'https://testnet.coti.io/rpc', fingerprint: 'candidate' } as never;
    const catalog = resolveOtcV2DeploymentCatalog(candidate, { ...CURRENT_P2P_BINDING, status: 'admitted' });
    const config = resolveDirectTradeV2DeploymentConfig({}, candidate, catalog);
    if (config.status !== 'active' || catalog.status !== 'active') throw new Error('Expected active');
    expect(config.manifest).toBe(catalog.deployments['direct-v2'].manifest);
    expect(config.retainedManifests).toEqual([catalog.preparedP2p!.retainedDeployments['direct-v2'].manifest]);
    expect(config.fingerprint).toContain(catalog.fingerprint);
    const activated = resolveDirectTradeV2DeploymentConfig({}, candidate);
    if (activated.status !== 'active') throw new Error('Expected activated private Direct');
    expect(activated.manifest.contractAddress).toBe(CURRENT_P2P_BINDING.deployments['direct-v2'].contractAddress);
    expect(activated.actionAdmission?.mode).toBe('private-forward');
    expect(activated.actionAdmission?.privateCounter).toBe(true);
    expect(activated.actionAdmission?.publicForward).toBe(true);
    expect(activated.actionAdmission?.publicCounter).toBe(true);
    expect(activated.retainedManifests).toEqual([catalog.preparedP2p!.retainedDeployments['direct-v2'].manifest]);
    const counterCatalog = resolveOtcV2DeploymentCatalog(candidate, { ...CURRENT_P2P_BINDING, directCounterAppActivated: false });
    const counter = resolveDirectTradeV2DeploymentConfig({}, candidate, counterCatalog);
    if (counter.status !== 'active') throw new Error('Expected private counter hold configuration');
    expect(counter.actionAdmission?.privateCounter).toBe(false);
    expect(counter.manifest).toEqual(activated.manifest);
    expect(counter.fingerprint).not.toBe(activated.fingerprint);
    const heldCatalog = resolveOtcV2DeploymentCatalog(candidate, { ...CURRENT_P2P_BINDING,
      directAppActivated: false, directPublicAppActivated: false, directPublicCounterAppActivated: false });
    const prepared = resolveDirectTradeV2DeploymentConfig({}, candidate, heldCatalog);
    expect(prepared.status === 'active' ? prepared.manifest.contractAddress : '').toBe(components.directOtcV2.address);
    expect(prepared.status === 'active' ? prepared.retainedManifests : undefined).toBeUndefined();
  });
  it('stays inactive by default and resolves invalid configuration without partial activation', () => {
    expect(parseDirectTradeV2DeploymentConfig({})).toEqual({ status: 'inactive' });
    expect(parseDirectTradeV2DeploymentConfig({ [DIRECT_TRADE_V2_ENV_KEYS.enabled]: 'false' }))
      .toEqual({ status: 'inactive' });
    expect(resolveDirectTradeV2DeploymentConfig({
      ...ACTIVE,
      [DIRECT_TRADE_V2_ENV_KEYS.contractAddress]: '0x1234'
    })).toEqual({ status: 'invalid', error: 'Direct Trade V2 deployment configuration is invalid.' });
  });

  it('freezes one exact Direct V2 deployment fingerprint', () => {
    const config = parseDirectTradeV2DeploymentConfig(ACTIVE);
    expect(config).toMatchObject({
      status: 'active',
      manifest: {
        protocol: 'direct-v2',
        chainId: '7082400',
        contractAddress: address('11'),
        deploymentBlock: '123',
        runtimeBytecodeHash: hash('22')
      },
      finalityLagBlocks: 5n,
      rpcUrl: 'https://testnet.coti.io/rpc'
    });
    expect(config.status === 'active' ? config.fingerprint : '').toContain('chainwhisper-direct-trade-v2');
    expect(Object.isFrozen(config)).toBe(true);
  });

  it.each([
    [DIRECT_TRADE_V2_ENV_KEYS.enabled, 'TRUE', /exactly true or false/],
    [DIRECT_TRADE_V2_ENV_KEYS.chainId, '07', /canonical decimal/],
    [DIRECT_TRADE_V2_ENV_KEYS.contractAddress, address('00'), /cannot be zero/],
    [DIRECT_TRADE_V2_ENV_KEYS.deploymentBlock, '0', /out of range/],
    [DIRECT_TRADE_V2_ENV_KEYS.runtimeBytecodeHash, hash('00'), /non-zero bytes32/],
    [DIRECT_TRADE_V2_ENV_KEYS.finalityLagBlocks, '0', /out of range/],
    [DIRECT_TRADE_V2_ENV_KEYS.finalityLagBlocks, '4097', /out of range/],
    [DIRECT_TRADE_V2_ENV_KEYS.rpcUrl, 'http://example.com', /RPC URL/],
    [DIRECT_TRADE_V2_ENV_KEYS.rpcUrl, 'https://user:secret@example.com', /RPC URL/]
  ])('rejects invalid %s', (key, value, expected) => {
    expect(() => parseDirectTradeV2DeploymentConfig({ ...ACTIVE, [key]: value })).toThrow(expected);
  });

  it('requires every deployment field only when explicitly enabled', () => {
    for (const key of Object.values(DIRECT_TRADE_V2_ENV_KEYS).filter(
      (value) => value !== DIRECT_TRADE_V2_ENV_KEYS.enabled
    )) {
      const env = { ...ACTIVE };
      delete env[key as keyof typeof env];
      expect(() => parseDirectTradeV2DeploymentConfig(env)).toThrow(key);
    }
  });
});
