import { getAddress, keccak256, toUtf8Bytes } from '@coti-io/coti-ethers';
import { describe, expect, it } from 'vitest';
import {
  parseTestnetCandidateConfig,
  TESTNET_CANDIDATE_COMPONENTS,
  TESTNET_CANDIDATE_ENV_KEYS
} from './chainWhisperTestnetCandidate';
import { findOtcV2Deployment, resolveOtcV2DeploymentCatalog } from './otcV2DeploymentCatalog';
import { CURRENT_P2P_BINDING, CURRENT_P2P_PROTOCOLS } from './currentP2PBinding';

const address = (index: number): string => getAddress(`0x${index.toString(16).padStart(40, '0')}`);
const hash = (label: string): string => keccak256(toUtf8Bytes(label));
const preparedBinding = { ...CURRENT_P2P_BINDING, status: 'prepared' as const };
const privateOnlyBinding = { ...CURRENT_P2P_BINDING, directPublicAppActivated: false, directPublicCounterAppActivated: false, publicBookLinkAppState: 'held' as const };

describe('retained financial graph catalog', () => {
  it('retains all five exact old targets together and rejects an incomplete parent graph', () => {
    const deployments = Object.values(CURRENT_P2P_BINDING.deployments).map((manifest, index) => ({ ...manifest,
      contractAddress: `0x${String(80 + index).repeat(20)}` }));
    const graph = { previousBindingSha256: 'ab'.repeat(32), proofSha256: 'cd'.repeat(32), deployments };
    const selected = { ...CURRENT_P2P_BINDING, repairQualification: undefined, retainedFinancialGraphs: [graph] };
    const catalog = resolveOtcV2DeploymentCatalog(activeCandidate(), selected);
    if (catalog.status !== 'active') throw new Error('expected active');
    for (const manifest of deployments) {
      const descriptor = findOtcV2Deployment(catalog, manifest.chainId, manifest.contractAddress);
      expect(descriptor?.manifest).toEqual(manifest); expect(descriptor?.retainedFinancialGraph).toEqual(graph);
    }
    expect(resolveOtcV2DeploymentCatalog(activeCandidate(), { ...selected,
      retainedFinancialGraphs: [{ ...graph, deployments: deployments.slice(1) }] }).status).toBe('invalid');
  });
});

describe('public Book and Link catalog admission', () => {
  it('selects the current Book only with the public proof and explicit activation', () => {
    const held = resolveOtcV2DeploymentCatalog(activeCandidate(), { ...CURRENT_P2P_BINDING, publicBookLinkAppState: 'held' });
    const active = resolveOtcV2DeploymentCatalog(activeCandidate(), { ...CURRENT_P2P_BINDING, publicBookLinkAppState: 'active' });
    if (held.status !== 'active' || active.status !== 'active' || !active.preparedP2p) throw new Error('expected active');
    expect(active.preparedP2p.publicBookLinkAdmitted).toBe(true);
    expect(active.preparedP2p.publicBookLinkRecoveryAdmitted).toBe(true);
    expect(active.deployments['standard-v2']).toBe(active.preparedP2p.deployments['standard-v2']);
    expect(active.fingerprint).not.toBe(held.fingerprint);
    expect(active.preparedP2p.status).toBe('book-admitted');
    expect(active.preparedP2p.directAdmission).toEqual(held.preparedP2p?.directAdmission);
    expect(active.preparedP2p.retainedDeployments['standard-v2']).toEqual(held.deployments['standard-v2']);
  });
  it('keeps current public discovery and exits in recovery while blocking new funding', () => {
    const recovery = resolveOtcV2DeploymentCatalog(activeCandidate(), { ...CURRENT_P2P_BINDING, publicBookLinkAppState: 'recovery' });
    if (recovery.status !== 'active' || !recovery.preparedP2p) throw new Error('expected active');
    expect(recovery.preparedP2p.publicBookLinkAdmitted).toBe(false);
    expect(recovery.preparedP2p.publicBookLinkRecoveryAdmitted).toBe(true);
    expect(recovery.deployments['standard-v2']).toBe(recovery.preparedP2p.deployments['standard-v2']);
    expect(recovery.preparedP2p.privateCounterAdmitted).toBe(true);
  });
  it('holds public funding and recovery for absent, duplicate or mismatched native identities', () => {
    const selected = { ...CURRENT_P2P_BINDING, publicBookLinkAppState: 'active' as const };
    const checks = [
      { publicBookLinkNativeStatus: 'prepared' }, { status: 'prepared' as const }, { linkAdmitted: false },
      { publicBookLinkProofs: [] }, { publicBookLinkProofs: [...selected.publicBookLinkProofs, selected.publicBookLinkProofs[0]] },
      ...(['chainId', 'genesisHash', 'parent', 'parentRuntimeHash', 'counter', 'counterRuntimeHash', 'forwardProofSha256', 'counterProofSha256'] as const)
        .map(key => ({ publicBookLinkProofs: selected.publicBookLinkProofs.map((proof, index) => index === 0 ? { ...proof, [key]: '' } : proof) }))
    ];
    for (const change of checks) {
      const catalog = resolveOtcV2DeploymentCatalog(activeCandidate(), { ...selected, ...change });
      if (catalog.status !== 'active' || !catalog.preparedP2p) throw new Error('expected active');
      expect(catalog.preparedP2p.publicBookLinkAdmitted).toBe(false);
      expect(catalog.preparedP2p.publicBookLinkRecoveryAdmitted).toBe(false);
      expect(catalog.deployments['standard-v2']).not.toBe(catalog.preparedP2p.deployments['standard-v2']);
    }
  });
});
const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalize(item)]));
  }
  return value;
};

const activeCandidate = () => {
  const components = Object.entries(TESTNET_CANDIDATE_COMPONENTS).map(([key, contract], index) => ({
    key,
    contract,
    address: address(index + 1),
    runtimeBytecodeHash: hash(`runtime-${index}`),
    ...(key === 'recoveryGcv3' ? {} : { deploymentBlock: String(100 + index) })
  }));
  const body = {
    schemaVersion: 1,
    status: 'attested-testnet-candidate-not-app-active',
    network: 'cotiTestnet',
    chainId: '7082400',
    owner: address(100),
    attestationBlock: { number: '500', hash: hash('attestation') },
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
  const manifest = { ...body, manifestHash: keccak256(toUtf8Bytes(JSON.stringify(canonicalize(body)))) };
  return parseTestnetCandidateConfig({
    [TESTNET_CANDIDATE_ENV_KEYS.enabled]: 'true',
    [TESTNET_CANDIDATE_ENV_KEYS.manifest]: JSON.stringify(manifest),
    [TESTNET_CANDIDATE_ENV_KEYS.finalityLagBlocks]: '5',
    [TESTNET_CANDIDATE_ENV_KEYS.rpcUrl]: 'https://testnet.coti.io/rpc'
  });
};

describe('otcV2DeploymentCatalog', () => {
  it('contextual trade balance admission changes policy fingerprint without other activation', () => {
    const candidate = activeCandidate(), held = resolveOtcV2DeploymentCatalog(candidate, { ...CURRENT_P2P_BINDING, tradeBalanceProofs: [] }), deployment = CURRENT_P2P_BINDING.deployments['private-v2'];
    const qualified = resolveOtcV2DeploymentCatalog(candidate, { ...CURRENT_P2P_BINDING, tradeBalanceProofs: [{ protocol: 'private-v2',
      chainId: deployment.chainId, genesisHash: CURRENT_P2P_BINDING.genesisHash, contractAddress: deployment.contractAddress,
      runtimeBytecodeHash: deployment.runtimeBytecodeHash, proofSha256: 'ab'.repeat(32), nativeStatus: 'native-trade-balance-verified', appState: 'active', variants: ['private-pair'] }] });
    if (held.status !== 'active' || qualified.status !== 'active') throw new Error('Expected active catalogs.');
    expect(held.preparedP2p?.tradeBalanceAdmissions?.['private-v2']?.mode).toBe('held');
    expect(qualified.preparedP2p?.tradeBalanceAdmissions?.['private-v2']?.mode).toBe('active');
    expect(qualified.preparedP2p?.tradeBalanceAdmissions?.['direct-v2']?.mode).toBe('held');
    expect(qualified.deployments).toEqual(held.deployments); expect(qualified.preparedP2p?.bookBudgetAdmission).toEqual(held.preparedP2p?.bookBudgetAdmission);
    expect(qualified.fingerprint).not.toBe(held.fingerprint);
  });
  it('Book budget native admission changes only its bound policy and fingerprint', () => {
    const candidate = activeCandidate(), held = resolveOtcV2DeploymentCatalog(candidate, { ...CURRENT_P2P_BINDING, bookBudgetProof: undefined });
    const book = CURRENT_P2P_BINDING.deployments['private-v2'];
    const admitted = resolveOtcV2DeploymentCatalog(candidate, { ...CURRENT_P2P_BINDING,
      bookBudgetNativeStatus: 'native-book-budget-verified', bookBudgetAppState: 'active',
      bookBudgetProof: { chainId: book.chainId, genesisHash: CURRENT_P2P_BINDING.genesisHash, book: book.contractAddress,
        bookRuntimeHash: book.runtimeBytecodeHash, proofSha256: 'ab'.repeat(32) } });
    if (held.status !== 'active' || admitted.status !== 'active') throw new Error('Expected active catalogs.');
    expect(held.preparedP2p?.bookBudgetAdmission?.mode).toBe('held');
    expect(admitted.preparedP2p?.bookBudgetAdmission).toMatchObject({ chainId: book.chainId, contractAddress: book.contractAddress,
      runtimeBytecodeHash: book.runtimeBytecodeHash, mode: 'active', proofSha256: 'ab'.repeat(32) });
    expect(admitted.deployments).toEqual(held.deployments); expect(admitted.preparedP2p?.retainedDeployments).toEqual(held.preparedP2p?.retainedDeployments);
    expect(admitted.preparedP2p?.directAdmission).toEqual(held.preparedP2p?.directAdmission); expect(admitted.fingerprint).not.toBe(held.fingerprint);
  });
  it('changes only private Counter admission and its fingerprint after explicit qualified activation', () => {
    const candidate = activeCandidate(), held = resolveOtcV2DeploymentCatalog(candidate, { ...CURRENT_P2P_BINDING, privateExternalCounterAppState: 'held' });
    const enabled = resolveOtcV2DeploymentCatalog(candidate, { ...CURRENT_P2P_BINDING, privateExternalCounterAppState: 'active' });
    const recovery = resolveOtcV2DeploymentCatalog(candidate, { ...CURRENT_P2P_BINDING, privateExternalCounterAppState: 'recovery' });
    if (held.status !== 'active' || enabled.status !== 'active' || recovery.status !== 'active') throw new Error('expected active');
    expect(held.preparedP2p?.privateCounterAdmitted).toBe(false); expect(enabled.preparedP2p?.privateCounterAdmitted).toBe(true);
    expect(held.preparedP2p?.privateCounterRecoveryAdmitted).toBe(false);
    expect(enabled.preparedP2p?.privateCounterRecoveryAdmitted).toBe(true);
    expect(recovery.preparedP2p).toMatchObject({ privateCounterAdmitted: false, privateCounterRecoveryAdmitted: true });
    expect(enabled.preparedP2p?.status).toBe('book-admitted'); expect(enabled.deployments).toEqual(held.deployments);
    expect(enabled.preparedP2p?.retainedDeployments).toEqual(held.preparedP2p?.retainedDeployments);
    expect(enabled.fingerprint).not.toBe(held.fingerprint);
    expect(recovery.fingerprint).not.toBe(enabled.fingerprint);
    expect(recovery.deployments).toEqual(enabled.deployments);
  });
  it('fingerprints public forward and counter permissions separately while preserving every deployment identity', () => {
    const candidate = activeCandidate();
    const held = resolveOtcV2DeploymentCatalog(candidate, privateOnlyBinding);
    const forward = resolveOtcV2DeploymentCatalog(candidate, { ...privateOnlyBinding,
      directPublicVerified: true, directPublicAppActivated: true });
    const counter = resolveOtcV2DeploymentCatalog(candidate, { ...privateOnlyBinding,
      directPublicVerified: true, directPublicAppActivated: true, directPublicCounterVerified: true, directPublicCounterAppActivated: true });
    if (held.status !== 'active' || forward.status !== 'active' || counter.status !== 'active') throw new Error('expected active');
    expect(forward.preparedP2p?.directAdmission).toMatchObject({ publicForward: true, publicCounter: false });
    expect(counter.preparedP2p?.directAdmission.publicCounter).toBe(true);
    expect(new Set([held.fingerprint, forward.fingerprint, counter.fingerprint]).size).toBe(3);
    expect(forward.deployments).toEqual(held.deployments); expect(counter.deployments).toEqual(held.deployments);
    expect(counter.preparedP2p?.retainedDeployments).toEqual(held.preparedP2p?.retainedDeployments);
  });

  it('selects qualified public Direct without admitting private Direct or the rest of the graph', () => {
    const candidate = activeCandidate(), selected = { ...CURRENT_P2P_BINDING, directPrivateVerified: false, directAppActivated: false,
      directPublicVerified: true, directPublicAppActivated: true };
    const catalog = resolveOtcV2DeploymentCatalog(candidate, selected);
    const held = resolveOtcV2DeploymentCatalog(candidate, { ...selected, directPublicAppActivated: false });
    if (catalog.status !== 'active' || held.status !== 'active' || !catalog.preparedP2p) throw new Error('expected active');
    expect(catalog.preparedP2p.status).toBe('book-admitted');
    expect(catalog.preparedP2p.directAdmission.mode).toBe('public-forward');
    expect(catalog.deployments['direct-v2']).toBe(catalog.preparedP2p.deployments['direct-v2']);
    expect(catalog.deployments['standard-v2']).toEqual(held.deployments['standard-v2']);
    expect(catalog.deployments['private-v2']).toEqual(held.deployments['private-v2']);
    expect(catalog.preparedP2p.retainedDeployments).toEqual(held.preparedP2p?.retainedDeployments);
    expect(catalog.fingerprint).not.toBe(held.fingerprint);
  });

  it('changes the policy fingerprint for admitted private counters without changing selected or retained deployment identities', () => {
    const candidate = activeCandidate(), held = resolveOtcV2DeploymentCatalog(candidate, { ...CURRENT_P2P_BINDING, directCounterAppActivated: false });
    const enabled = resolveOtcV2DeploymentCatalog(candidate);
    if (held.status !== 'active' || enabled.status !== 'active') throw new Error('expected active');
    expect(held.preparedP2p?.directAdmission.privateCounter).toBe(false);
    expect(enabled.preparedP2p?.directAdmission.privateCounter).toBe(true);
    expect(enabled.deployments).toEqual(held.deployments);
    expect(enabled.preparedP2p?.retainedDeployments).toEqual(held.preparedP2p?.retainedDeployments);
    expect(enabled.fingerprint).not.toBe(held.fingerprint);
  });

  it('selects verified Direct independently only after explicit activation and retains the previous scope', () => {
    const candidate = activeCandidate();
    const held = resolveOtcV2DeploymentCatalog(candidate, { ...privateOnlyBinding, directPrivateVerified: true, directAppActivated: false });
    const catalog = resolveOtcV2DeploymentCatalog(candidate, privateOnlyBinding);
    if (catalog.status !== 'active' || held.status !== 'active' || !catalog.preparedP2p) throw new Error('expected active');
    expect(catalog.preparedP2p.status).toBe('book-admitted');
    expect(catalog.deployments['direct-v2']).toBe(catalog.preparedP2p.deployments['direct-v2']);
    expect(catalog.preparedP2p.directAdmission.mode).toBe('private-forward');
    expect(catalog.preparedP2p.retainedDeployments['direct-v2']).toEqual(held.deployments['direct-v2']);
    expect(catalog.deployments['standard-v2']).toEqual(held.deployments['standard-v2']);
    expect(catalog.fingerprint).not.toBe(held.fingerprint);
  });

  it('keeps Direct held if its private proof or activation is missing', () => {
    const candidate = activeCandidate();
    for (const flags of [{ directPrivateVerified: false, directAppActivated: true }, { directPrivateVerified: true, directAppActivated: false }]) {
      const catalog = resolveOtcV2DeploymentCatalog(candidate, { ...privateOnlyBinding, ...flags });
      if (catalog.status !== 'active' || !catalog.preparedP2p) throw new Error('expected active');
      expect(catalog.preparedP2p.directAdmission.mode).toBe('held');
      expect(catalog.deployments['direct-v2']).not.toBe(catalog.preparedP2p.deployments['direct-v2']);
    }
  });

  it('changes the Direct runtime fingerprint when its selected identity changes', () => {
    const candidate = activeCandidate(), selected = { ...CURRENT_P2P_BINDING, repairQualification: undefined, directAppActivated: true };
    const initial = resolveOtcV2DeploymentCatalog(candidate, selected);
    for (const change of [{ contractAddress: address(90) }, { runtimeBytecodeHash: hash('changed-direct') }, { deploymentBlock: '999' }]) {
      const next = resolveOtcV2DeploymentCatalog(candidate, { ...selected, deployments: { ...selected.deployments,
        'direct-v2': { ...selected.deployments['direct-v2'], ...change } } });
      if (initial.status !== 'active' || next.status !== 'active') throw new Error('expected active');
      expect(next.fingerprint).not.toBe(initial.fingerprint);
    }
  });
  it('retains the old Link address and selects the new Link without admitting Counter or other graph modes', () => {
    const catalog = resolveOtcV2DeploymentCatalog(activeCandidate());
    if (catalog.status !== 'active' || !catalog.preparedP2p) throw new Error('expected active');
    expect(catalog.preparedP2p.linkAdmitted).toBe(true);
    expect(catalog.preparedP2p.status).toBe('book-admitted');
    expect(catalog.preparedP2p.deployments['link-v2'].manifest.contractAddress).toBe(CURRENT_P2P_BINDING.deployments['link-v2'].contractAddress);
    const old = findOtcV2Deployment(catalog, catalog.chainId, '0xcdf70597ebd1e4eb440e292a23003d129d9c5859');
    expect(old?.manifest).toMatchObject({ protocol: 'link-v2', contractAddress: '0xcdf70597ebd1e4eb440e292a23003d129d9c5859', deploymentBlock: '10225108' });
    expect(findOtcV2Deployment(catalog, '1', '0xcdf70597ebd1e4eb440e292a23003d129d9c5859')).toBeUndefined();
  });
  it('selects only the repaired Book and retains both replaced Books for exact-reference recovery', () => {
    const candidate = activeCandidate();
    const catalog = resolveOtcV2DeploymentCatalog(candidate, { ...privateOnlyBinding, directAppActivated: false });
    const prior = resolveOtcV2DeploymentCatalog(candidate, { ...CURRENT_P2P_BINDING, status: 'prepared' });
    if (catalog.status !== 'active' || prior.status !== 'active') throw new Error('expected active');
    expect(catalog.deployments['private-v2'].manifest.contractAddress).toBe(CURRENT_P2P_BINDING.deployments['private-v2'].contractAddress);
    for (const protocol of ['standard-v2', 'direct-v2', 'recurring-v2', 'private-recurring-v2'] as const) {
      expect(catalog.deployments[protocol]).toEqual(prior.deployments[protocol]);
    }
    for (const contractAddress of ['0x53d5a94a884533df7e79bef37a4818f5c5746787', '0x846340d4d85b91542d386688249169146ec73215']) {
      const retained = findOtcV2Deployment(catalog, '7082400', contractAddress);
      expect(retained?.manifest).toMatchObject({ protocol: 'private-v2', contractAddress });
      expect(retained).not.toBe(catalog.deployments['private-v2']);
    }
    expect(catalog.fingerprint).not.toBe(prior.fingerprint);
  });
  it('selects an explicitly admitted graph while retaining every older deployment', () => {
    const candidate = activeCandidate();
    const catalog = resolveOtcV2DeploymentCatalog(candidate, { ...CURRENT_P2P_BINDING, status: 'admitted' });
    const prior = resolveOtcV2DeploymentCatalog(candidate, preparedBinding);
    if (catalog.status !== 'active' || prior.status !== 'active' || !catalog.preparedP2p) throw new Error('expected active');
    for (const protocol of ['standard-v2', 'private-v2', 'direct-v2'] as const) {
      expect(catalog.deployments[protocol]).toBe(catalog.preparedP2p.deployments[protocol]);
      expect(catalog.preparedP2p.retainedDeployments[protocol]).toEqual(prior.deployments[protocol]);
      expect(findOtcV2Deployment(catalog, catalog.chainId, prior.deployments[protocol].manifest.contractAddress)).toBe(catalog.preparedP2p.retainedDeployments[protocol]);
    }
    expect(catalog.deployments['recurring-v2']).toEqual(prior.deployments['recurring-v2']);
    expect(catalog.deployments['private-recurring-v2']).toEqual(prior.deployments['private-recurring-v2']);
    expect(catalog.fingerprint).not.toBe(prior.fingerprint);
    expect(catalog.preparedP2p.status).toBe('admitted');
    expect(CURRENT_P2P_BINDING.status).toBe('book-admitted');
  });
  it('resolves current and retained escrows by chain and address without activating a prepared graph', () => {
    const catalog = resolveOtcV2DeploymentCatalog(activeCandidate(), preparedBinding);
    if (catalog.status !== 'active' || !catalog.preparedP2p) throw new Error('expected active');
    for (const deployment of [...Object.values(catalog.deployments), ...Object.values(catalog.preparedP2p.deployments)]) {
      expect(findOtcV2Deployment(catalog, catalog.chainId, deployment.manifest.contractAddress.toUpperCase())).toBe(deployment);
      expect(findOtcV2Deployment(catalog, '1', deployment.manifest.contractAddress)).toBeUndefined();
    }
    expect(findOtcV2Deployment(catalog, catalog.chainId, `0x${'99'.repeat(20)}`)).toBeUndefined();
    expect(findOtcV2Deployment({ status: 'inactive' }, catalog.chainId, catalog.deployments['standard-v2'].manifest.contractAddress)).toBeUndefined();
    expect(catalog.preparedP2p.status).toBe('prepared');
  });
  it('prepares the registered graph without replacing any selected or retained deployment', () => {
    const candidate = activeCandidate();
    const catalog = resolveOtcV2DeploymentCatalog(candidate, preparedBinding);
    if (candidate.status !== 'active' || catalog.status !== 'active') throw new Error('expected active');
    const prepared = catalog.preparedP2p;
    expect(prepared?.status).toBe('prepared');
    expect(Object.keys(prepared!.deployments)).toEqual([...CURRENT_P2P_PROTOCOLS]);
    for (const protocol of CURRENT_P2P_PROTOCOLS) {
      expect(prepared!.deployments[protocol].manifest).toEqual(CURRENT_P2P_BINDING.deployments[protocol]);
      expect(prepared!.deployments[protocol].rpcUrl).toBe(catalog.rpcUrl);
    }
    expect(prepared!.retainedDeployments).toBe(catalog.deployments);
    expect(catalog.deployments['private-v2'].manifest.contractAddress).toBe(candidate.components.privateOtcV2.address);
    expect(prepared!.deployments['private-v2'].manifest.contractAddress).not.toBe(catalog.deployments['private-v2'].manifest.contractAddress);
  });
  it('stays atomically inactive or invalid with its candidate suite', () => {
    expect(resolveOtcV2DeploymentCatalog({ status: 'inactive' })).toEqual({ status: 'inactive' });
    expect(resolveOtcV2DeploymentCatalog({ status: 'invalid', error: 'redacted' })).toEqual({
      status: 'invalid',
      error: 'OTC V2 testnet candidate is invalid.'
    });
  });

  it('maps all five protocols to exact candidate components and one policy', () => {
    const candidate = activeCandidate();
    expect(candidate.status).toBe('active');
    const catalog = resolveOtcV2DeploymentCatalog(candidate, preparedBinding);
    expect(catalog.status).toBe('active');
    if (candidate.status !== 'active' || catalog.status !== 'active') throw new Error('expected active');
    expect(Object.keys(catalog.deployments)).toEqual([
      'standard-v2',
      'private-v2',
      'direct-v2',
      'recurring-v2',
      'private-recurring-v2'
    ]);
    expect(catalog.deployments['standard-v2'].manifest.contractAddress)
      .toBe(candidate.components.standardOtcV2.address);
    expect(catalog.deployments['private-v2'].manifest.contractAddress)
      .toBe(candidate.components.privateOtcV2.address);
    expect(catalog.deployments['direct-v2'].manifest.contractAddress)
      .toBe(candidate.components.directOtcV2.address);
    expect(catalog.deployments['recurring-v2'].manifest.contractAddress)
      .toBe(candidate.components.recurringOtcV2.address);
    expect(catalog.deployments['private-recurring-v2'].manifest.contractAddress)
      .toBe(candidate.components['private-recurringOtcV2'].address);
    expect(new Set(Object.values(catalog.deployments).map(({ finalityLagBlocks }) => finalityLagBlocks)))
      .toEqual(new Set([5n]));
    expect(new Set(Object.values(catalog.deployments).map(({ rpcUrl }) => rpcUrl)))
      .toEqual(new Set(['https://testnet.coti.io/rpc']));
    expect(Object.isFrozen(catalog.deployments)).toBe(true);
  });
});
