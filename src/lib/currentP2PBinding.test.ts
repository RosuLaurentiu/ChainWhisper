import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import fixtureProvenance from '../../tests/fixtures/provenance.json';
import { CURRENT_P2P_BINDING, CURRENT_P2P_PROTOCOLS } from './currentP2PBinding';
import { isPrivateBookV2RuntimeHash, PRIVATE_BOOK_V2_RUNTIME_HASH } from './privateBookV2Actions';
import binding from './currentP2PBinding.json';
import previousBinding from '../../tests/fixtures/p2p-previousBinding.json';
import disclosureNative from '../../tests/fixtures/p2p-disclosureNative.json';
import { normalizeCurrentP2PRegisteredTokens } from './currentP2PBinding';
import native from '../../tests/fixtures/p2p-native.json';
import linkNative from '../../tests/fixtures/p2p-linkNative.json';
import directNative from '../../tests/fixtures/p2p-directNative.json';
import directCounterNative from '../../tests/fixtures/p2p-directCounterNative.json';
import publicDirectNative from '../../tests/fixtures/p2p-publicDirectNative.json';
import publicDirectCounterNative from '../../tests/fixtures/p2p-publicDirectCounterNative.json';
import { assertCurrentP2PDirectActionAdmission, resolveCurrentP2PDirectAdmission, resolveCurrentP2PBookBudgetAdmission, isCurrentP2PBookBudgetAdmitted,
  resolveCurrentP2PTradeBalanceAdmission, assertCurrentP2PTradeBalanceAdmission, isCurrentP2PFinancialScopeQualified, isCurrentP2PPublicBookLinkAdmitted } from './currentP2PBinding';

const baselineBinding = { ...CURRENT_P2P_BINDING, repairQualification: undefined, retainedFinancialGraphs: [], tradeBalanceProofs: [],
  bookBudgetNativeStatus: undefined, bookBudgetProof: undefined, bookBudgetAppState: 'held' as const,
  deployments: Object.fromEntries(CURRENT_P2P_PROTOCOLS.map(protocol => {
    const component = previousBinding.components.find(item => item.protocol === protocol)!;
    return [protocol, { protocol, chainId: previousBinding.chainId, contractAddress: component.address,
      runtimeBytecodeHash: component.runtimeBytecodeHash, deploymentBlock: component.deploymentBlock }];
  })) as typeof CURRENT_P2P_BINDING.deployments };
const activeBinding = CURRENT_P2P_BINDING;

describe('registered P2P token metadata', () => {
  it('projects the exact six native-registered identities and holds incomplete or invalid metadata', () => {
    expect(CURRENT_P2P_BINDING.registeredTokens.map(token => token.symbol)).toEqual(['cwPTA', 'cwPTB', 'BCN', 'HBR', 'EMBR', 'ORBT']);
    for (const token of CURRENT_P2P_BINDING.registeredTokens) {
      expect(disclosureNative.registrations).toContainEqual(expect.objectContaining({ token: expect.stringMatching(new RegExp(`^${token.address}$`, 'i')),
        symbol: token.symbol, privateToken: token.kind === 'private-erc20', tokenRuntimeHash: token.runtimeBytecodeHash }));
      expect(token.decimals).toBe(6); expect(Object.isFrozen(token)).toBe(true);
    }
    const tokens = CURRENT_P2P_BINDING.registeredTokens;
    for (const malformed of [undefined, tokens.slice(1), [...tokens.slice(1), tokens[1]], tokens.map((token, index) => index ? token : { ...token, decimals: 18 }),
      tokens.map((token, index) => index ? token : { ...token, kind: 'native' }), tokens.map((token, index) => index ? token : { ...token, runtimeBytecodeHash: '' })])
      expect(normalizeCurrentP2PRegisteredTokens(malformed)).toEqual([]);
  });
});

describe('contextual trade balance admission', () => {
  it('keeps the adopted repair scope and native/shared evidence labels distinct from old financial producers', () => {
    expect(isCurrentP2PFinancialScopeQualified()).toBe(true);
    expect(CURRENT_P2P_BINDING.financialQualification).toBe('unchanged-core-reuse');
    expect(CURRENT_P2P_BINDING.status).toBe('book-admitted');
    // Public projections retain producer identity; full native evidence stays in its producer workspace.
    expect(createHash('sha256').update(readFileSync(new URL('../../tests/fixtures/p2p-previousBinding.json', import.meta.url))).digest('hex'))
      .toBe(fixtureProvenance['p2p-previousBinding.json'].fixtureSha256);
    expect(CURRENT_P2P_BINDING.repairQualification?.previousBindingSha256).toBe(fixtureProvenance['p2p-previousBinding.json'].sourceSha256);
    expect(binding.privateCounterProofs).toEqual(previousBinding.privateCounterProofs);
    expect(binding.publicBookLinkProofs).toEqual(previousBinding.publicBookLinkProofs);
    for (const protocol of ['private-v2', 'direct-v2'] as const)
      expect(resolveCurrentP2PTradeBalanceAdmission(protocol)).toMatchObject({ mode: 'active', qualification: 'native-trade-balance-verified' });
    for (const protocol of ['link-v2', 'counter-v2'] as const)
      expect(resolveCurrentP2PTradeBalanceAdmission(protocol)).toMatchObject({ mode: 'active', qualification: 'shared-native-variant-qualified' });
  });
  it.each([['link-v2', 'stored-ct', 'private-v2'], ['counter-v2', 'caller-gt', 'direct-v2']] as const)('preserves shared native qualification for %s without claiming target execution', (protocol, nativeVariant, producerProtocol) => {
    const proof = { ...CURRENT_P2P_BINDING.deployments[protocol], protocol, genesisHash: CURRENT_P2P_BINDING.genesisHash,
      proofSha256: 'ab'.repeat(32), nativeStatus: 'shared-native-variant-qualified' as const, nativeVariant, producerProtocol,
      appState: 'active' as const, variants: ['private-pair'] as const };
    const selected = { ...CURRENT_P2P_BINDING, tradeBalanceProofs: [proof] };
    expect(resolveCurrentP2PTradeBalanceAdmission(protocol, selected)).toMatchObject({ mode: 'active', qualification: 'shared-native-variant-qualified', nativeVariant, producerProtocol });
    for (const patch of [{ producerProtocol: undefined }, { nativeVariant: undefined }, { contractAddress: `0x${'77'.repeat(20)}` }])
      expect(resolveCurrentP2PTradeBalanceAdmission(protocol, { ...selected, tradeBalanceProofs: [{ ...proof, ...patch }] }).mode).toBe('held');
    expect(resolveCurrentP2PTradeBalanceAdmission('private-v2', { ...selected, tradeBalanceProofs: [{ ...proof, protocol: 'private-v2' }] }).mode).toBe('held');
  });
  it('inherits only the old financial scope under an exact repair qualification and retains old proof addresses', () => {
    const old = Object.values(baselineBinding.deployments), proofSha256 = 'ab'.repeat(32), previousBindingSha256 = 'cd'.repeat(32);
    const deployments = Object.fromEntries(old.map((manifest, index) => [manifest.protocol, { ...manifest, contractAddress: `0x${String(90 + index).repeat(20)}` }])) as typeof CURRENT_P2P_BINDING.deployments;
    const selected = { ...baselineBinding, deployments, repairQualification: { status: 'unchanged-financial-core-qualified' as const, appState: 'active' as const,
      chainId: CURRENT_P2P_BINDING.chainId, genesisHash: CURRENT_P2P_BINDING.genesisHash, candidateSha256: 'ef'.repeat(32), proofSha256, previousBindingSha256,
      targets: Object.values(deployments) }, retainedFinancialGraphs: [{ proofSha256, previousBindingSha256, deployments: old }] };
    expect(isCurrentP2PFinancialScopeQualified(selected)).toBe(true);
    expect(resolveCurrentP2PDirectAdmission(selected)).toMatchObject({ mode: 'private-forward', publicForward: true, privateCounter: true, publicCounter: true });
    expect(isCurrentP2PPrivateCounterAdmitted(selected)).toBe(isCurrentP2PPrivateCounterAdmitted());
    expect(isCurrentP2PPublicBookLinkAdmitted(selected)).toBe(isCurrentP2PPublicBookLinkAdmitted());
    expect(resolveCurrentP2PTradeBalanceAdmission('private-v2', selected).mode).toBe('held');
    expect(resolveCurrentP2PBookBudgetAdmission(selected).mode).toBe('held');
    for (const patch of [{ appState: 'held' as const }, { proofSha256: '' }, { targets: selected.repairQualification.targets.slice(1) }])
      expect(isCurrentP2PFinancialScopeQualified({ ...selected, repairQualification: { ...selected.repairQualification, ...patch } })).toBe(false);
    expect(isCurrentP2PFinancialScopeQualified({ ...selected, retainedFinancialGraphs: [] })).toBe(false);
  });
  it.each(['private-v2', 'direct-v2', 'link-v2', 'counter-v2'] as const)('holds %s until exact private-pair native proof and activation', protocol => {
    const deployment = CURRENT_P2P_BINDING.deployments[protocol];
    expect(resolveCurrentP2PTradeBalanceAdmission(protocol, { ...CURRENT_P2P_BINDING, tradeBalanceProofs: [] }).mode).toBe('held');
    const proof = { protocol, chainId: deployment.chainId, genesisHash: CURRENT_P2P_BINDING.genesisHash,
      contractAddress: deployment.contractAddress, runtimeBytecodeHash: deployment.runtimeBytecodeHash, proofSha256: 'ab'.repeat(32),
      nativeStatus: 'native-trade-balance-verified' as const, appState: 'active' as const, variants: ['private-pair'] as const };
    const selected = { ...CURRENT_P2P_BINDING, tradeBalanceProofs: [proof] };
    const admitted = resolveCurrentP2PTradeBalanceAdmission(protocol, selected);
    expect(admitted.mode).toBe('active'); expect(() => assertCurrentP2PTradeBalanceAdmission(deployment, admitted, 'private-pair')).not.toThrow();
    expect(() => assertCurrentP2PTradeBalanceAdmission({ ...deployment, contractAddress: `0x${'99'.repeat(20)}` }, admitted)).toThrow(/unavailable/);
    for (const patch of [{ proofSha256: '' }, { contractAddress: `0x${'99'.repeat(20)}` }, { runtimeBytecodeHash: `0x${'99'.repeat(32)}` },
      { genesisHash: `0x${'99'.repeat(32)}` }, { appState: 'held' as const }]) {
      expect(resolveCurrentP2PTradeBalanceAdmission(protocol, { ...selected, tradeBalanceProofs: [{ ...proof, ...patch }] }).mode).toBe('held');
    }
    expect(resolveCurrentP2PTradeBalanceAdmission(protocol, { ...selected, tradeBalanceProofs: [proof, proof] }).mode).toBe('held');
    expect(resolveCurrentP2PTradeBalanceAdmission(protocol, { ...CURRENT_P2P_BINDING, status: 'admitted', tradeBalanceProofs: [] }).mode).toBe('held');
  });
});

describe('Book budget native admission', () => {
  const qualified = () => ({ ...CURRENT_P2P_BINDING, bookBudgetNativeStatus: 'native-book-budget-verified', bookBudgetAppState: 'active' as const,
    bookBudgetProof: { chainId: CURRENT_P2P_BINDING.chainId, genesisHash: CURRENT_P2P_BINDING.genesisHash,
      book: CURRENT_P2P_BINDING.deployments['private-v2'].contractAddress, bookRuntimeHash: CURRENT_P2P_BINDING.deployments['private-v2'].runtimeBytecodeHash,
      proofSha256: 'ab'.repeat(32) } });
  it('defaults held even when the rest of the graph is admitted', () => {
    expect(resolveCurrentP2PBookBudgetAdmission({ ...CURRENT_P2P_BINDING, bookBudgetProof: undefined }).mode).toBe('held');
    expect(resolveCurrentP2PBookBudgetAdmission({ ...CURRENT_P2P_BINDING, status: 'admitted', bookBudgetProof: undefined }).mode).toBe('held');
  });
  it('requires exact deployment proof and activation and never admits another retained identity', () => {
    const selected = qualified(), policy = resolveCurrentP2PBookBudgetAdmission(selected), book = selected.deployments['private-v2'];
    expect(policy.mode).toBe('active'); expect(isCurrentP2PBookBudgetAdmitted(book, policy)).toBe(true);
    for (const patch of [{ chainId: '1' }, { contractAddress: `0x${'12'.repeat(20)}` }, { runtimeBytecodeHash: `0x${'12'.repeat(32)}` }]) {
      expect(isCurrentP2PBookBudgetAdmitted({ ...book, ...patch }, policy)).toBe(false);
    }
    for (const patch of [{ proofSha256: '' }, { chainId: '1' }, { genesisHash: `0x${'12'.repeat(32)}` },
      { book: `0x${'12'.repeat(20)}` }, { bookRuntimeHash: `0x${'12'.repeat(32)}` }]) {
      expect(resolveCurrentP2PBookBudgetAdmission({ ...selected, bookBudgetProof: { ...selected.bookBudgetProof, ...patch } }).mode).toBe('held');
    }
    expect(resolveCurrentP2PBookBudgetAdmission({ ...selected, bookBudgetAppState: 'held' }).mode).toBe('held');
    expect(resolveCurrentP2PBookBudgetAdmission({ ...selected, bookBudgetNativeStatus: undefined }).mode).toBe('held');
  });
});
import { isCurrentP2PPrivateCounterAdmitted, isCurrentP2PPrivateCounterRecoveryAdmitted } from './currentP2PBinding';
import bookCounterNative from '../../tests/fixtures/p2p-bookCounterNative.json';
import linkCounterNative from '../../tests/fixtures/p2p-linkCounterNative.json';

const privateOnlyBinding = { ...CURRENT_P2P_BINDING, directPublicAppActivated: false, directPublicCounterAppActivated: false };

describe('public Book and Link proof admission', () => {
  const CURRENT_P2P_BINDING = baselineBinding;
  it('binds public native projections and retained producer identities without replaying transactions', () => {
    const base = '../../tests/fixtures/';
    for (const [directory, protocol, status, field] of [
      ['public-standard-2026-10-25', 'standard-v2', 'VERIFIED_NATIVE_PUBLIC_STANDARD_COUNTER_CASE', 'forwardProofSha256'],
      ['public-link-2026-10-25', 'link-v2', 'VERIFIED_NATIVE_PUBLIC_LINK_CASE', 'forwardProofSha256'],
      ['public-link-counter-2026-10-25', 'link-v2', 'VERIFIED_NATIVE_PUBLIC_LINK_COUNTER_CASE', 'counterProofSha256']
    ] as const) {
      const bytes = readFileSync(new URL(`${base}${directory}.json`, import.meta.url));
      const proof = JSON.parse(bytes.toString('utf8'));
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(fixtureProvenance[`${directory}.json` as keyof typeof fixtureProvenance].fixtureSha256);
      expect(CURRENT_P2P_BINDING.publicBookLinkProofs.find(p => p.parentProtocol === protocol)?.[field]).toBe(fixtureProvenance[`${directory}.json` as keyof typeof fixtureProvenance].sourceSha256);
      expect(proof.status).toBe(status);
      expect(String(proof.chainId)).toBe(CURRENT_P2P_BINDING.chainId);
      expect(proof.genesisHash).toBe(CURRENT_P2P_BINDING.genesisHash);
      expect(proof.binding).toMatchObject({ address: CURRENT_P2P_BINDING.deployments[protocol].contractAddress,
        runtimeHash: CURRENT_P2P_BINDING.deployments[protocol].runtimeBytecodeHash });
      expect(proof.observed).toMatchObject({ caseRemaining: '0', tokenEscrowDeltasZero: true, noPending: true });
    }
  });
  it('records the accepted public parents and separate owner-approved App activation', () => {
    expect(CURRENT_P2P_BINDING.publicBookLinkNativeStatus).toBe('native-public-book-link-counter-verified');
    expect(CURRENT_P2P_BINDING.publicBookLinkAppState).toBe('active');
    expect(CURRENT_P2P_BINDING.publicBookLinkProofs).toEqual([
      { parentProtocol: 'standard-v2', chainId: CURRENT_P2P_BINDING.chainId, genesisHash: CURRENT_P2P_BINDING.genesisHash,
        parent: CURRENT_P2P_BINDING.deployments['standard-v2'].contractAddress, parentRuntimeHash: CURRENT_P2P_BINDING.deployments['standard-v2'].runtimeBytecodeHash,
        counter: CURRENT_P2P_BINDING.deployments['counter-v2'].contractAddress, counterRuntimeHash: CURRENT_P2P_BINDING.deployments['counter-v2'].runtimeBytecodeHash,
        forwardProofSha256: 'c5a5d8ebee79bc2510ac9dd289e75a829099be4684c71929b9d1f2f6d25d208a',
        counterProofSha256: 'c5a5d8ebee79bc2510ac9dd289e75a829099be4684c71929b9d1f2f6d25d208a' },
      { parentProtocol: 'link-v2', chainId: CURRENT_P2P_BINDING.chainId, genesisHash: CURRENT_P2P_BINDING.genesisHash,
        parent: CURRENT_P2P_BINDING.deployments['link-v2'].contractAddress, parentRuntimeHash: CURRENT_P2P_BINDING.deployments['link-v2'].runtimeBytecodeHash,
        counter: CURRENT_P2P_BINDING.deployments['counter-v2'].contractAddress, counterRuntimeHash: CURRENT_P2P_BINDING.deployments['counter-v2'].runtimeBytecodeHash,
        forwardProofSha256: '4ce3546bfa53adf6713c28ca805ce1a6d6d724b8317b445edf87566e41967271',
        counterProofSha256: 'b5db54d849f7e1aaab0effb928e538a005cc890908545235eae3ae3449e13465' }
    ]);
  });
});

describe('registered P2P App binding', () => {
  const CURRENT_P2P_BINDING = baselineBinding;
  const binding = previousBinding;
  it('records exact native private parent proofs and owner-approved external Counter activation', () => {
    expect(CURRENT_P2P_BINDING.privateCounterNativeStatus).toBe('native-private-book-link-counter-verified');
    expect(CURRENT_P2P_BINDING.privateExternalCounterAppState).toBe('active');
    expect(isCurrentP2PPrivateCounterAdmitted()).toBe(true);
    expect(isCurrentP2PPrivateCounterRecoveryAdmitted()).toBe(true);
    expect(CURRENT_P2P_BINDING.privateCounterProofs).toHaveLength(2);
    for (const [protocol, proof, parent, digest] of [
      ['private-v2', bookCounterNative, bookCounterNative.book, '5e9b6abb5032bd954618f57921ea82ccc7f54ea45f900cfdf93a3a001f7d7be6'],
      ['link-v2', linkCounterNative, linkCounterNative.binding, '6a311cece5f5c19e05e0c6cebe9d1f6c54bd2b70d18813c96fc8565796cf7f52']
    ] as const) {
      expect(CURRENT_P2P_BINDING.deployments[protocol]).toMatchObject({ chainId: String(proof.chainId), contractAddress: parent.address.toLowerCase(), runtimeBytecodeHash: parent.runtimeHash });
      expect(CURRENT_P2P_BINDING.deployments['counter-v2']).toMatchObject({ contractAddress: proof.counter.address.toLowerCase(), runtimeBytecodeHash: proof.counter.runtimeHash });
      expect(CURRENT_P2P_BINDING.privateCounterProofs.find(p => p.parentProtocol === protocol)).toMatchObject({
        chainId: String(proof.chainId), genesisHash: proof.genesisHash, parent: parent.address.toLowerCase(), parentRuntimeHash: parent.runtimeHash,
        counter: proof.counter.address.toLowerCase(), counterRuntimeHash: proof.counter.runtimeHash, proofSha256: digest
      });
      expect(proof.observed.noPending).toBe(true);
    }
  });

  it('admits private external Counter only with both exact parents, proofs and explicit activation', () => {
    const selected = { ...CURRENT_P2P_BINDING, privateExternalCounterAppState: 'active' as const };
    expect(isCurrentP2PPrivateCounterAdmitted(selected)).toBe(true);
    expect(isCurrentP2PPrivateCounterRecoveryAdmitted(selected)).toBe(true);
    const recovery = { ...selected, privateExternalCounterAppState: 'recovery' as const };
    expect(isCurrentP2PPrivateCounterAdmitted(recovery)).toBe(false);
    expect(isCurrentP2PPrivateCounterRecoveryAdmitted(recovery)).toBe(true);
    for (const missing of [{ privateExternalCounterAppState: 'held' as const }, { linkAdmitted: false }, { status: 'prepared' as const },
      { privateCounterNativeStatus: 'prepared' }, { privateCounterProofs: [] },
      { privateCounterProofs: selected.privateCounterProofs.map(p => ({ ...p, proofSha256: '' })) }, { chainId: '1' }]) {
      expect(isCurrentP2PPrivateCounterAdmitted({ ...selected, ...missing })).toBe(false);
      expect(isCurrentP2PPrivateCounterRecoveryAdmitted({ ...selected, ...missing })).toBe(false);
    }
    for (const protocol of ['private-v2', 'link-v2', 'counter-v2'] as const) {
      const changed = { ...selected, deployments: { ...selected.deployments,
        [protocol]: { ...selected.deployments[protocol], runtimeBytecodeHash: `0x${'12'.repeat(32)}` } } };
      expect(isCurrentP2PPrivateCounterAdmitted(changed)).toBe(false);
      expect(isCurrentP2PPrivateCounterRecoveryAdmitted(changed)).toBe(false);
    }
  });

  it('records both native public Direct proofs and owner-approved App activation', () => {
    expect(CURRENT_P2P_BINDING.directPublicVerified).toBe(true);
    expect(CURRENT_P2P_BINDING.directPublicAppActivated).toBe(true);
    expect(CURRENT_P2P_BINDING.directPublicCounterVerified).toBe(true);
    expect(CURRENT_P2P_BINDING.directPublicCounterAppActivated).toBe(true);
    const admission = resolveCurrentP2PDirectAdmission();
    expect(admission).toMatchObject({ mode: 'private-forward', publicForward: true, publicCounter: true, privateCounter: true });
    for (const kind of ['create-public', 'accept-public', 'counter-public', 'create-private', 'accept-private', 'counter-private', 'cancel']) {
      expect(() => assertCurrentP2PDirectActionAdmission(admission, kind, admission)).not.toThrow();
    }
    for (const kind of ['replace-private', 'replace-public']) {
      expect(() => assertCurrentP2PDirectActionAdmission(admission, kind, admission)).toThrow(/not ready/);
    }
    expect(binding.directPublicProofSha256).toBe('18b37378130dc3c5312b4f8f375195a9e4dab450abd1622339fbf4f9302059d6');
    expect(binding.directPublicCounterProofSha256).toBe('6b5073ba0497f435f1b64ece1d084d249211743a8e3161a05ca35e56a6b0229e');
    expect(publicDirectNative.status).toBe('VERIFIED_NATIVE_PUBLIC_DIRECT_CASE');
    expect(publicDirectNative.observed).toMatchObject({ noPending: true, escrowZero: true, offerPaid: '75000', requestReceived: '25000' });
    expect(publicDirectCounterNative.status).toBe('VERIFIED_NATIVE_PUBLIC_DIRECT_COUNTER_CASE');
    expect(publicDirectCounterNative.observed).toMatchObject({ noPending: true, escrowZero: true, parentRefund: '75000', requestPaid: '60000', offerReceived: '20000' });
    for (const proof of [publicDirectNative, publicDirectCounterNative]) {
      expect(String(proof.chainId)).toBe(CURRENT_P2P_BINDING.chainId);
      expect(CURRENT_P2P_BINDING.deployments['direct-v2']).toMatchObject({
        contractAddress: proof.binding.address.toLowerCase(), runtimeBytecodeHash: proof.binding.runtimeHash
      });
      expect(proof.authority.closed).toBe(true);
      expect(proof.sourcePins['APP/src/lib/currentP2PBinding.json']).toBe('bba3790126ec77fd53defe8ffea9a339f6dc0f8cd0df3fe6843a328a5f8d63a8');
    }
  });

  it('admits only public forward actions with their own native proof and explicit activation', () => {
    const selected = { ...privateOnlyBinding, directPublicVerified: true, directPublicAppActivated: true };
    const admission = resolveCurrentP2PDirectAdmission(selected);
    expect(admission).toMatchObject({ mode: 'private-forward', publicForward: true, publicCounter: false, privateCounter: true });
    for (const kind of ['create-public', 'accept-public', 'create-private', 'counter-private', 'cancel']) {
      expect(() => assertCurrentP2PDirectActionAdmission(admission, kind, admission)).not.toThrow();
    }
    for (const kind of ['counter-public', 'replace-private', 'replace-public']) {
      expect(() => assertCurrentP2PDirectActionAdmission(admission, kind, admission)).toThrow(/not ready/);
    }
    for (const missing of [{ directPublicVerified: false }, { directPublicAppActivated: false }, { status: 'prepared' as const }]) {
      const held = resolveCurrentP2PDirectAdmission({ ...selected, ...missing });
      expect(held.publicForward).toBe(false);
      expect(() => assertCurrentP2PDirectActionAdmission(held, 'create-public', held)).toThrow();
    }
    for (const mismatch of [{ chainId: '1' }, { contractAddress: `0x${'12'.repeat(20)}` }, { runtimeBytecodeHash: `0x${'12'.repeat(32)}` }]) {
      expect(() => assertCurrentP2PDirectActionAdmission(admission, 'accept-public', { ...admission, ...mismatch })).toThrow(/differ/);
    }
  });

  it('admits public counters independently of private proof only when both public paths are qualified', () => {
    const selected = { ...CURRENT_P2P_BINDING, directPrivateVerified: false, directAppActivated: false,
      directPublicVerified: true, directPublicAppActivated: true, directPublicCounterVerified: true, directPublicCounterAppActivated: true };
    const admission = resolveCurrentP2PDirectAdmission(selected);
    expect(admission).toMatchObject({ mode: 'public-forward', publicForward: true, publicCounter: true, privateCounter: false });
    for (const kind of ['create-public', 'accept-public', 'counter-public', 'cancel']) {
      expect(() => assertCurrentP2PDirectActionAdmission(admission, kind, admission)).not.toThrow();
    }
    for (const kind of ['create-private', 'accept-private', 'counter-private', 'replace-private', 'replace-public']) {
      expect(() => assertCurrentP2PDirectActionAdmission(admission, kind, admission)).toThrow(/not ready/);
    }
    for (const missing of [{ directPublicVerified: false }, { directPublicAppActivated: false },
      { directPublicCounterVerified: false }, { directPublicCounterAppActivated: false }, { status: 'prepared' as const }]) {
      const held = resolveCurrentP2PDirectAdmission({ ...selected, ...missing });
      expect(held.publicCounter).toBe(false);
      expect(() => assertCurrentP2PDirectActionAdmission(held, 'counter-public', held)).toThrow();
    }
  });

  it('records native private counter proof and owner-approved counter activation', () => {
    expect(CURRENT_P2P_BINDING.directPrivateCounterVerified).toBe(true);
    expect(CURRENT_P2P_BINDING.directCounterAppActivated).toBe(true);
    expect(CURRENT_P2P_BINDING.directAppActivated).toBe(true);
    expect(CURRENT_P2P_BINDING.deployments['direct-v2']).toMatchObject({
      contractAddress: directCounterNative.binding.address.toLowerCase(), runtimeBytecodeHash: directCounterNative.binding.runtimeHash
    });
    expect(directCounterNative.status).toBe('VERIFIED_NATIVE_PRIVATE_DIRECT_COUNTER_CASE');
    expect(directCounterNative.observed.noPending).toBe(true);
    expect(binding.directCounterProofSha256).toBe('7f11689253477f072f696cb1b101e34a889037dd12b92f4902c754194e5d67dd');
    expect(resolveCurrentP2PDirectAdmission().privateCounter).toBe(true);
  });

  it('admits only private counters with both proofs and activation, keeping other actions and missing prerequisites held', () => {
    const selected = privateOnlyBinding;
    const enabled = resolveCurrentP2PDirectAdmission(selected);
    expect(enabled.mode).toBe('private-forward'); expect(enabled.privateCounter).toBe(true);
    for (const kind of ['create-private', 'accept-private', 'counter-private', 'cancel', 'decline']) {
      expect(() => assertCurrentP2PDirectActionAdmission(enabled, kind, enabled)).not.toThrow();
    }
    for (const kind of ['create-public', 'accept-public', 'counter-public', 'replace-private', 'replace-public']) {
      expect(() => assertCurrentP2PDirectActionAdmission(enabled, kind, enabled)).toThrow(/not ready/);
    }
    for (const missing of [{ directPrivateCounterVerified: false }, { directCounterAppActivated: false },
      { directPrivateVerified: false }, { directAppActivated: false }, { status: 'prepared' as const }]) {
      const held = resolveCurrentP2PDirectAdmission({ ...selected, ...missing });
      expect(held.privateCounter).toBe(false);
      expect(() => assertCurrentP2PDirectActionAdmission(held, 'counter-private', held)).toThrow();
    }
    expect(() => assertCurrentP2PDirectActionAdmission(enabled, 'counter-private', { ...enabled, runtimeBytecodeHash: `0x${'12'.repeat(32)}` })).toThrow(/differ/);
  });

  it('holds new Direct funding before activation while keeping direct owner exits', () => {
    const admission = resolveCurrentP2PDirectAdmission({ ...privateOnlyBinding, directAppActivated: false });
    expect(admission.mode).toBe('held');
    for (const kind of ['create-private', 'accept-private', 'create-public', 'counter-private', 'replace-private']) {
      expect(() => assertCurrentP2PDirectActionAdmission(admission, kind, admission)).toThrow(/activation/);
    }
    for (const kind of ['cancel', 'decline', 'reclaim-expired', 'withdraw-native-credit']) {
      expect(() => assertCurrentP2PDirectActionAdmission(admission, kind, admission)).not.toThrow();
    }
  });

  it('admits only the qualified private forward path when counter activation is held and binds its exact scope', () => {
    const admission = resolveCurrentP2PDirectAdmission({ ...privateOnlyBinding, directCounterAppActivated: false });
    expect(admission.mode).toBe('private-forward');
    for (const kind of ['create-private', 'accept-private']) expect(() => assertCurrentP2PDirectActionAdmission(admission, kind, admission)).not.toThrow();
    for (const kind of ['create-public', 'accept-public', 'counter-private', 'counter-public', 'replace-private', 'replace-public']) {
      expect(() => assertCurrentP2PDirectActionAdmission(admission, kind, admission)).toThrow(/not ready/);
    }
    expect(() => assertCurrentP2PDirectActionAdmission(admission, 'create-private', { ...admission, contractAddress: `0x${'12'.repeat(20)}` })).toThrow(/differ/);
    expect(() => assertCurrentP2PDirectActionAdmission(admission, 'create-private', { ...admission, runtimeBytecodeHash: `0x${'12'.repeat(32)}` })).toThrow(/differ/);
    expect(() => assertCurrentP2PDirectActionAdmission(admission, 'create-private', { ...admission, chainId: '1' })).toThrow(/differ/);
    expect(() => assertCurrentP2PDirectActionAdmission({ ...admission, contractAddress: `0x${'34'.repeat(20)}` }, 'counter-public', admission)).not.toThrow();
  });

  it('retains the full action set under explicit full-graph admission', () => {
    const admission = resolveCurrentP2PDirectAdmission({ ...CURRENT_P2P_BINDING, status: 'admitted' });
    expect(admission.mode).toBe('full');
    for (const kind of ['create-private', 'accept-private', 'create-public', 'accept-public', 'counter-private', 'counter-public', 'replace-private', 'replace-public']) {
      expect(() => assertCurrentP2PDirectActionAdmission(admission, kind, admission)).not.toThrow();
    }
    expect(() => assertCurrentP2PDirectActionAdmission(admission, 'unknown', admission)).toThrow(/not ready/);
  });
  it('records verified private Direct settlement and owner-approved App activation', () => {
    expect(CURRENT_P2P_BINDING.directPrivateVerified).toBe(true);
    expect(CURRENT_P2P_BINDING.directAppActivated).toBe(true);
    expect(CURRENT_P2P_BINDING.deployments['direct-v2']).toMatchObject({
      contractAddress: directNative.binding.address.toLowerCase(), runtimeBytecodeHash: directNative.binding.runtimeHash
    });
    expect(directNative.status).toBe('VERIFIED_NATIVE_PRIVATE_DIRECT_CASE');
    expect(directNative.observed.noPending).toBe(true);
    expect(binding.directProofSha256).toMatch(/^[0-9a-f]{64}$/);
  });
  it('binds the repaired native Book and its Math without admitting the other prepared protocols', () => {
    expect(CURRENT_P2P_BINDING.status).toBe('book-admitted');
    expect(CURRENT_P2P_BINDING.chainId).toBe('7082400');
    expect(Object.keys(CURRENT_P2P_BINDING.deployments)).toEqual([...CURRENT_P2P_PROTOCOLS]);
    expect(new Set(Object.values(CURRENT_P2P_BINDING.deployments).map(d => d.contractAddress)).size).toBe(5);
    expect(CURRENT_P2P_BINDING.deployments['private-v2']).toMatchObject({
      contractAddress: native.book.address.toLowerCase(), runtimeBytecodeHash: native.book.runtimeHash,
      deploymentBlock: String(native.receipts[1].blockNumber)
    });
    expect(binding.components.find(c => c.contract === 'ChainWhisperPrivateBookMath')).toMatchObject({
      address: native.math.address.toLowerCase(), runtimeBytecodeHash: native.math.runtimeHash,
      deploymentBlock: String(native.receipts[0].blockNumber), deploymentBlockHash: native.receipts[0].blockHash
    });
    expect(CURRENT_P2P_BINDING.deployments['counter-v2'].deploymentBlock).toBe('10225113');
    expect(Object.isFrozen(activeBinding.deployments)).toBe(true);
    expect(Object.values(activeBinding.deployments).every(d => Object.isFrozen(d))).toBe(true);
  });

  it('selects the verified repaired Link pair and retains the replaced Link for exact-reference recovery', () => {
    expect(CURRENT_P2P_BINDING.deployments['link-v2']).toMatchObject({
      contractAddress: linkNative.setup.link.address.toLowerCase(), runtimeBytecodeHash: linkNative.setup.link.runtimeHash,
      deploymentBlock: String(linkNative.receipts[1].blockNumber)
    });
    expect(binding.components.find(c => c.contract === 'ChainWhisperLinkPrivateMath')).toMatchObject({
      address: linkNative.setup.math.address.toLowerCase(), runtimeBytecodeHash: linkNative.setup.math.runtimeHash,
      deploymentBlock: String(linkNative.receipts[0].blockNumber), deploymentBlockHash: linkNative.receipts[0].blockHash
    });
    expect(CURRENT_P2P_BINDING.linkAdmitted).toBe(true);
    expect(CURRENT_P2P_BINDING.status).toBe('book-admitted');
    expect(CURRENT_P2P_BINDING.retainedLinks).toContainEqual(expect.objectContaining({
      protocol: 'link-v2', chainId: '7082400', contractAddress: '0xcdf70597ebd1e4eb440e292a23003d129d9c5859',
      runtimeBytecodeHash: '0x074062a395d26e4f421f5b75a4b6f96f206996285fdd56566d96576ce41ff384'
    }));
  });

  it('recognizes both public-price book versions and excludes legacy or unknown semantics', () => {
    expect(isPrivateBookV2RuntimeHash(PRIVATE_BOOK_V2_RUNTIME_HASH)).toBe(true);
    expect(isPrivateBookV2RuntimeHash(CURRENT_P2P_BINDING.deployments['private-v2'].runtimeBytecodeHash)).toBe(true);
    expect(isPrivateBookV2RuntimeHash('0xe20848f75e59634a16c7d33dd393e91698292a9b29400d456ff57ab0c04ac680')).toBe(false);
    expect(isPrivateBookV2RuntimeHash(CURRENT_P2P_BINDING.deployments['direct-v2'].runtimeBytecodeHash)).toBe(false);
    expect(isPrivateBookV2RuntimeHash('0x' + '00'.repeat(32))).toBe(false);
  });
});
