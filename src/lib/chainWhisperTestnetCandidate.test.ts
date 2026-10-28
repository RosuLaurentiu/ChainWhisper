import { getAddress, keccak256, toUtf8Bytes } from '@coti-io/coti-ethers';
import { describe, expect, it } from 'vitest';
import {
  parseTestnetCandidateConfig,
  resolveTestnetCandidateConfig,
  TESTNET_CANDIDATE_COMPONENTS,
  TESTNET_CANDIDATE_ENV_KEYS
} from './chainWhisperTestnetCandidate';
import { resolveDirectChatV2DeploymentConfig } from './directChatV2Deployment';
import { resolveDirectTradeV2DeploymentConfig } from './directTradeV2Deployment';
import { CURRENT_P2P_BINDING } from './currentP2PBinding';
import { resolveGroupChatV2DeploymentConfig } from './groupChatV2Deployment';
import { resolveChatReactionsV1DeploymentConfig } from './chatReactionsV1Deployment';
import {
  PRIVATE_LIQUIDITY_V2_ENV_KEYS,
  resolvePrivateLiquidityV2DeploymentConfig
} from './privateLiquidityV2Deployment';

const address = (index: number): string => getAddress(`0x${index.toString(16).padStart(40, '0')}`);
const hash = (label: string): string => keccak256(toUtf8Bytes(label));
const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalize(item)]));
  }
  return value;
};

const manifest = () => {
  const components = Object.entries(TESTNET_CANDIDATE_COMPONENTS).map(([key, contract], index) => ({
    key,
    contract,
    address: address(index + 1),
    runtimeBytecodeHash: hash(`runtime-${index}`),
    deploymentBlock: String(100 + index)
  }));
  const body = {
    schemaVersion: 1,
    status: 'attested-testnet-candidate-not-app-active',
    network: 'cotiTestnet',
    chainId: '7082400',
    owner: address(100),
    attestationBlock: { number: '500', hash: hash('attestation-block') },
    components,
    relationships: {
      chatReactionsV1: {
        directChatV2: components.find(({ key }) => key === 'directChatV2')?.address,
        groupChatV2: components.find(({ key }) => key === 'groupChatV2')?.address
      },
      tokenAdmissionOperations: 16,
      appActivated: false
    }
  };
  return { ...body, manifestHash: keccak256(toUtf8Bytes(JSON.stringify(canonicalize(body)))) };
};

const env = (candidate = manifest()) => ({
  [TESTNET_CANDIDATE_ENV_KEYS.enabled]: 'true',
  [TESTNET_CANDIDATE_ENV_KEYS.manifest]: JSON.stringify(candidate),
  [TESTNET_CANDIDATE_ENV_KEYS.finalityLagBlocks]: '5',
  [TESTNET_CANDIDATE_ENV_KEYS.rpcUrl]: 'https://testnet.coti.io/rpc'
});

describe('chainWhisperTestnetCandidate', () => {
  it('stays inactive until the complete suite is explicitly enabled', () => {
    expect(parseTestnetCandidateConfig({})).toEqual({ status: 'inactive' });
    expect(parseTestnetCandidateConfig({ [TESTNET_CANDIDATE_ENV_KEYS.enabled]: 'false' }))
      .toEqual({ status: 'inactive' });
  });

  it('parses and fingerprints the exact 15-component attested suite', () => {
    const config = parseTestnetCandidateConfig(env());
    expect(config.status).toBe('active');
    if (config.status !== 'active') throw new Error('expected active');
    expect(Object.keys(config.components)).toHaveLength(15);
    expect(config.components.directChatV2.contract).toBe('ChainWhisperChatV2');
    expect(config.finalityLagBlocks).toBe(5n);
    expect(config.chainId).toBe('7082400');
    expect(Object.isFrozen(config.components)).toBe(true);
  });

  it('rejects tampering, dependency drift, extra fields, and incomplete components', () => {
    const tampered = manifest();
    tampered.owner = address(101);
    expect(() => parseTestnetCandidateConfig(env(tampered))).toThrow(/manifest hash/);
    const drift = manifest();
    drift.relationships.chatReactionsV1.directChatV2 = address(200);
    drift.manifestHash = keccak256(toUtf8Bytes(JSON.stringify(canonicalize({
      ...drift,
      manifestHash: undefined
    }))));
    expect(() => parseTestnetCandidateConfig(env(drift))).toThrow();
    const extra = { ...manifest(), unexpected: true };
    expect(() => parseTestnetCandidateConfig(env(extra as never))).toThrow(/fields/);
    const incomplete = manifest();
    incomplete.components.pop();
    expect(() => parseTestnetCandidateConfig(env(incomplete))).toThrow(/15 components/);
  });

  it('returns a non-descriptive invalid state for production callers', () => {
    expect(resolveTestnetCandidateConfig({
      [TESTNET_CANDIDATE_ENV_KEYS.enabled]: 'true',
      [TESTNET_CANDIDATE_ENV_KEYS.manifest]: '{}'
    })).toEqual({
      status: 'invalid',
      error: 'ChainWhisper testnet candidate configuration is invalid.'
    });
  });

  it('derives the V2 suite with the approved Direct selection and retains its old manifest', () => {
    const candidate = parseTestnetCandidateConfig(env());
    expect(candidate.status).toBe('active');
    const directChat = resolveDirectChatV2DeploymentConfig({}, candidate);
    const groupChat = resolveGroupChatV2DeploymentConfig({}, candidate);
    const reactions = resolveChatReactionsV1DeploymentConfig({}, directChat, groupChat, candidate);
    const directTrade = resolveDirectTradeV2DeploymentConfig({}, candidate);
    const liquidity = resolvePrivateLiquidityV2DeploymentConfig({
      [PRIVATE_LIQUIDITY_V2_ENV_KEYS.bookDeploymentBlockHash]: hash('book-block'),
      [PRIVATE_LIQUIDITY_V2_ENV_KEYS.bookCreationTransactionHash]: hash('book-tx'),
      [PRIVATE_LIQUIDITY_V2_ENV_KEYS.moduleDeploymentBlockHash]: hash('module-block'),
      [PRIVATE_LIQUIDITY_V2_ENV_KEYS.moduleCreationTransactionHash]: hash('module-tx'),
      [PRIVATE_LIQUIDITY_V2_ENV_KEYS.positionTokenDeploymentBlockHash]: hash('book-block'),
      [PRIVATE_LIQUIDITY_V2_ENV_KEYS.positionTokenCreationTransactionHash]: hash('book-tx')
    }, candidate);
    expect(directChat.status === 'active' && directChat.manifest.contractAddress)
      .toBe(candidate.status === 'active' ? candidate.components.directChatV2.address : '');
    expect(groupChat.status === 'active' && groupChat.manifest.contractAddress)
      .toBe(candidate.status === 'active' ? candidate.components.groupChatV2.address : '');
    expect(reactions.status === 'active' && reactions.manifest.directChatV2.contractAddress)
      .toBe(candidate.status === 'active' ? candidate.components.directChatV2.address : '');
    expect(directTrade.status === 'active' && directTrade.manifest.contractAddress)
      .toBe(CURRENT_P2P_BINDING.deployments['direct-v2'].contractAddress);
    expect(directTrade.status === 'active' && directTrade.actionAdmission?.mode).toBe('private-forward');
    expect(directTrade.status === 'active' && directTrade.retainedManifests).toContainEqual(expect.objectContaining({
      contractAddress: candidate.status === 'active' ? candidate.components.directOtcV2.address : ''
    }));
    expect(liquidity.status === 'active' && liquidity.manifest.positionToken.address)
      .toBe(candidate.status === 'active' ? candidate.components.privateLiquidityPositionNftV2.address : '');
    expect(new Set([
      directChat.status === 'active' ? directChat.finalityLagBlocks : 0n,
      groupChat.status === 'active' ? groupChat.finalityLagBlocks : 0n,
      reactions.status === 'active' ? reactions.finalityLagBlocks : 0n,
      directTrade.status === 'active' ? directTrade.finalityLagBlocks : 0n,
      liquidity.status === 'active' ? liquidity.finalityLagBlocks : 0n
    ])).toEqual(new Set([5n]));
  });
});
