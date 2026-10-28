import binding from './currentP2PBinding.json';
import type { TradeHistoryV2ManifestInput } from './tradeHistoryV2Chain';

type PublicDirectBinding = Readonly<{
  directPublicStatus?: string;
  directPublicProofSha256?: string;
  directPublicAppActivated?: boolean;
  directPublicCounterStatus?: string;
  directPublicCounterProofSha256?: string;
  directPublicCounterAppActivated?: boolean;
}>;
type PrivateCounterProof = Readonly<{
  parentProtocol: 'private-v2' | 'link-v2'; chainId: string; genesisHash: string;
  parent: string; parentRuntimeHash: string; counter: string; counterRuntimeHash: string; proofSha256: string;
}>;
type PrivateCounterBinding = Readonly<{
  privateCounterStatus?: string;
  privateCounterProofs?: readonly PrivateCounterProof[];
  privateExternalCounterAppState?: 'held' | 'active' | 'recovery';
}>;
type PublicBookLinkProof = Readonly<Omit<PrivateCounterProof, 'parentProtocol' | 'proofSha256'> & {
  parentProtocol: 'standard-v2' | 'link-v2'; forwardProofSha256: string; counterProofSha256: string;
}>;
type PublicBookLinkBinding = Readonly<{
  publicBookLinkStatus?: string;
  publicBookLinkProofs?: readonly PublicBookLinkProof[];
  publicBookLinkAppState?: 'held' | 'active' | 'recovery';
}>;
type BookBudgetProof = Readonly<{ chainId: string; genesisHash: string; book: string; bookRuntimeHash: string; proofSha256: string }>;
type BookBudgetBinding = Readonly<{ bookBudgetStatus?: string; bookBudgetProof?: BookBudgetProof; bookBudgetAppState?: 'held' | 'active' }>;
export type CurrentP2PRegisteredToken = Readonly<{ address: string; kind: 'private-erc20' | 'erc20'; symbol: string;
  decimals: number; runtimeBytecodeHash: string }>;
export const normalizeCurrentP2PRegisteredTokens = (value: unknown): readonly CurrentP2PRegisteredToken[] => {
  if (!Array.isArray(value) || value.length !== 6) return Object.freeze([]);
  const tokens: CurrentP2PRegisteredToken[] = [];
  for (const token of value) {
    if (!token || typeof token !== 'object' || typeof token.address !== 'string' || !/^0x[0-9a-f]{40}$/i.test(token.address) ||
        !['erc20', 'private-erc20'].includes(token.kind) || typeof token.symbol !== 'string' || !token.symbol.trim() || token.decimals !== 6 ||
        typeof token.runtimeBytecodeHash !== 'string' || !/^0x[0-9a-f]{64}$/i.test(token.runtimeBytecodeHash)) return Object.freeze([]);
    tokens.push(Object.freeze({ address: token.address.toLowerCase(), kind: token.kind, symbol: token.symbol.trim(), decimals: token.decimals,
      runtimeBytecodeHash: token.runtimeBytecodeHash.toLowerCase() }));
  }
  if (new Set(tokens.map(token => token.address)).size !== 6 || tokens.filter(token => token.kind === 'erc20').length !== 2 ||
      tokens.filter(token => token.kind === 'private-erc20').length !== 4) return Object.freeze([]);
  return Object.freeze(tokens);
};
export type TradeBalanceDisclosureProtocol = 'private-v2' | 'direct-v2' | 'link-v2' | 'counter-v2';
export type TradeBalanceNativeVariant = 'private-pair';
type TradeBalanceProof = Readonly<{ protocol: TradeBalanceDisclosureProtocol; chainId: string; genesisHash: string;
  contractAddress: string; runtimeBytecodeHash: string; proofSha256: string;
  nativeStatus: 'native-trade-balance-verified' | 'shared-native-variant-qualified';
  nativeVariant?: 'stored-ct' | 'caller-gt'; producerProtocol?: 'private-v2' | 'direct-v2';
  appState: 'held' | 'active'; variants: readonly TradeBalanceNativeVariant[] }>;
export type P2PRepairQualification = Readonly<{
  status: 'unchanged-financial-core-qualified'; appState: 'held' | 'active'; chainId: string; genesisHash: string;
  candidateSha256: string; proofSha256: string; previousBindingSha256: string;
  targets: readonly Readonly<{ protocol: CurrentP2PProtocol; contractAddress: string; runtimeBytecodeHash: string }>[];
}>;
export type RetainedP2PFinancialGraph = Readonly<{ previousBindingSha256: string; proofSha256: string;
  deployments: readonly (TradeHistoryV2ManifestInput<CurrentP2PProtocol> & { protocol: CurrentP2PProtocol; chainId: string;
    contractAddress: string; runtimeBytecodeHash: string; deploymentBlock: string })[] }>;
// Optional proof/activation fields stay absent until the separate native and owner decisions.
const publicDirectBinding: PublicDirectBinding = binding;
const privateCounterBinding = binding as PrivateCounterBinding;
const publicBookLinkBinding = binding as PublicBookLinkBinding;
const bookBudgetBinding = binding as BookBudgetBinding;
const tradeBalanceBinding = binding as { tradeBalanceProofs?: readonly TradeBalanceProof[] };
const repairBinding = binding as { repairQualification?: P2PRepairQualification; retainedFinancialGraphs?: readonly RetainedP2PFinancialGraph[] };
const tokenBinding = binding as { registeredTokens?: readonly CurrentP2PRegisteredToken[] };
const proofRecorded = (value: string | undefined): boolean => /^[0-9a-f]{64}$/.test(value ?? '');

export const CURRENT_P2P_PROTOCOLS = ['standard-v2', 'private-v2', 'direct-v2', 'link-v2', 'counter-v2'] as const;
export type CurrentP2PProtocol = typeof CURRENT_P2P_PROTOCOLS[number];

const deployment = <P extends CurrentP2PProtocol>(protocol: P) => {
  const component = binding.components.find(item => item.protocol === protocol);
  if (!component) throw new Error('Registered P2P component is missing.');
  return Object.freeze({ protocol, chainId: binding.chainId, contractAddress: component.address,
    deploymentBlock: component.deploymentBlock, runtimeBytecodeHash: component.runtimeBytecodeHash } satisfies TradeHistoryV2ManifestInput<P>);
};

/** Observed deployment identity. Live admission and write authority remain separate. */
export const CURRENT_P2P_BINDING = Object.freeze({
  // The base suite selects the repaired Book. Link proof does not admit other graph modes.
  status: 'book-admitted' as 'prepared' | 'book-admitted' | 'admitted',
  linkAdmitted: binding.linkStatus === 'native-verified',
  directPrivateVerified: binding.directStatus === 'native-private-forward-verified',
  directAppActivated: binding.directAppActivated,
  directPrivateCounterVerified: binding.directCounterStatus === 'native-private-counter-verified',
  directCounterAppActivated: binding.directCounterAppActivated,
  directPublicVerified: publicDirectBinding.directPublicStatus === 'native-public-forward-verified' && proofRecorded(publicDirectBinding.directPublicProofSha256),
  directPublicAppActivated: publicDirectBinding.directPublicAppActivated === true,
  directPublicCounterVerified: publicDirectBinding.directPublicCounterStatus === 'native-public-counter-verified' && proofRecorded(publicDirectBinding.directPublicCounterProofSha256),
  directPublicCounterAppActivated: publicDirectBinding.directPublicCounterAppActivated === true,
  privateCounterNativeStatus: privateCounterBinding.privateCounterStatus,
  privateCounterProofs: Object.freeze((privateCounterBinding.privateCounterProofs ?? []).map(proof => Object.freeze({ ...proof }))),
  privateExternalCounterAppState: privateCounterBinding.privateExternalCounterAppState ?? 'held',
  publicBookLinkNativeStatus: publicBookLinkBinding.publicBookLinkStatus,
  publicBookLinkProofs: Object.freeze((publicBookLinkBinding.publicBookLinkProofs ?? []).map(proof => Object.freeze({ ...proof }))),
  publicBookLinkAppState: publicBookLinkBinding.publicBookLinkAppState ?? 'held',
  bookBudgetNativeStatus: bookBudgetBinding.bookBudgetStatus,
  bookBudgetProof: bookBudgetBinding.bookBudgetProof ? Object.freeze({ ...bookBudgetBinding.bookBudgetProof }) : undefined,
  bookBudgetAppState: bookBudgetBinding.bookBudgetAppState ?? 'held',
  tradeBalanceProofs: Object.freeze((tradeBalanceBinding.tradeBalanceProofs ?? []).map(proof => Object.freeze({ ...proof, variants: Object.freeze([...proof.variants]) }))),
  repairQualification: repairBinding.repairQualification,
  financialQualification: repairBinding.repairQualification ? 'unchanged-core-reuse' as const : 'prior-target-native' as const,
  registeredTokens: normalizeCurrentP2PRegisteredTokens(tokenBinding.registeredTokens),
  retainedFinancialGraphs: Object.freeze((repairBinding.retainedFinancialGraphs ?? []).map(graph => Object.freeze({ ...graph,
    deployments: Object.freeze(graph.deployments.map(manifest => Object.freeze({ ...manifest }))) }))),
  chainId: binding.chainId,
  genesisHash: binding.genesisHash,
  owner: binding.owner,
  sourceRecordSha256: binding.sourceRecordSha256,
  registrationRecordSha256: binding.registrationRecordSha256,
  retainedBooks: Object.freeze(binding.retainedBooks.map(book => Object.freeze({
    ...book, protocol: 'private-v2' as const, chainId: binding.chainId
  }))),
  retainedLinks: Object.freeze(binding.retainedLinks.map(link => Object.freeze({
    ...link, protocol: 'link-v2' as const, chainId: binding.chainId
  }))),
  deployments: Object.freeze({
    'standard-v2': deployment('standard-v2'),
    'private-v2': deployment('private-v2'),
    'direct-v2': deployment('direct-v2'),
    'link-v2': deployment('link-v2'),
    'counter-v2': deployment('counter-v2')
  })
});

/** The existing financial fields retain their old-target scope. This descriptor admits only its unchanged core on exact new targets. */
export const isCurrentP2PFinancialScopeQualified = (selected: typeof CURRENT_P2P_BINDING = CURRENT_P2P_BINDING): boolean => {
  const qualification = selected.repairQualification;
  if (!qualification) return true;
  return qualification.status === 'unchanged-financial-core-qualified' && qualification.appState === 'active' &&
    qualification.chainId === selected.chainId && qualification.genesisHash.toLowerCase() === selected.genesisHash.toLowerCase() &&
    [qualification.candidateSha256, qualification.proofSha256, qualification.previousBindingSha256].every(proofRecorded) &&
    selected.retainedFinancialGraphs.filter(graph => graph.previousBindingSha256 === qualification.previousBindingSha256 && graph.proofSha256 === qualification.proofSha256 &&
      graph.deployments.length === CURRENT_P2P_PROTOCOLS.length && CURRENT_P2P_PROTOCOLS.every(protocol =>
        graph.deployments.filter(item => item.protocol === protocol && item.chainId === selected.chainId).length === 1)).length === 1 &&
    qualification.targets.length === CURRENT_P2P_PROTOCOLS.length && CURRENT_P2P_PROTOCOLS.every(protocol => {
      const matches = qualification.targets.filter(target => target.protocol === protocol), deployment = selected.deployments[protocol];
      return matches.length === 1 && matches[0].contractAddress.toLowerCase() === deployment.contractAddress.toLowerCase() &&
        matches[0].runtimeBytecodeHash.toLowerCase() === deployment.runtimeBytecodeHash.toLowerCase();
    });
};
const financialProofDeployment = (selected: typeof CURRENT_P2P_BINDING, protocol: CurrentP2PProtocol) => selected.repairQualification
  ? selected.retainedFinancialGraphs.find(graph => graph.previousBindingSha256 === selected.repairQualification?.previousBindingSha256)?.deployments.find(item => item.protocol === protocol)
  : selected.deployments[protocol];

/** Partial Counter admission never enables public funding or the rest of the graph. */
const privateCounterQualified = (selected: typeof CURRENT_P2P_BINDING): boolean => {
  if (!isCurrentP2PFinancialScopeQualified(selected) || selected.status === 'prepared' || !selected.linkAdmitted ||
      selected.privateCounterNativeStatus !== 'native-private-book-link-counter-verified') return false;
  const same = (a: string | undefined, b: string): boolean => typeof a === 'string' && a.toLowerCase() === b.toLowerCase();
  return (['private-v2', 'link-v2'] as const).every(protocol => {
    const proofs = selected.privateCounterProofs.filter(proof => proof.parentProtocol === protocol);
    if (proofs.length !== 1) return false;
    const proof = proofs[0], parent = financialProofDeployment(selected, protocol), counter = financialProofDeployment(selected, 'counter-v2');
    return Boolean(parent && counter && proofRecorded(proof.proofSha256) && proof.chainId === selected.chainId && same(proof.genesisHash, selected.genesisHash) &&
      same(proof.parent, parent.contractAddress) && same(proof.parentRuntimeHash, parent.runtimeBytecodeHash) &&
      same(proof.counter, counter.contractAddress) && same(proof.counterRuntimeHash, counter.runtimeBytecodeHash));
  });
};
export const isCurrentP2PPrivateCounterAdmitted = (selected: typeof CURRENT_P2P_BINDING = CURRENT_P2P_BINDING): boolean =>
  selected.privateExternalCounterAppState === 'active' && privateCounterQualified(selected);
export const isCurrentP2PPrivateCounterRecoveryAdmitted = (selected: typeof CURRENT_P2P_BINDING = CURRENT_P2P_BINDING): boolean =>
  ['active', 'recovery'].includes(selected.privateExternalCounterAppState) && privateCounterQualified(selected);

/** Public proof and activation do not change private or Direct permissions. */
const publicBookLinkQualified = (selected: typeof CURRENT_P2P_BINDING): boolean => {
  if (!isCurrentP2PFinancialScopeQualified(selected) || selected.status === 'prepared' || !selected.linkAdmitted ||
      selected.publicBookLinkNativeStatus !== 'native-public-book-link-counter-verified') return false;
  const same = (a: string, b: string): boolean => typeof a === 'string' && a.toLowerCase() === b.toLowerCase();
  return (['standard-v2', 'link-v2'] as const).every(protocol => {
    const proofs = selected.publicBookLinkProofs.filter(proof => proof.parentProtocol === protocol);
    if (proofs.length !== 1) return false;
    const proof = proofs[0], parent = financialProofDeployment(selected, protocol), counter = financialProofDeployment(selected, 'counter-v2');
    return Boolean(parent && counter && proofRecorded(proof.forwardProofSha256) && proofRecorded(proof.counterProofSha256) &&
      proof.chainId === selected.chainId && same(proof.genesisHash, selected.genesisHash) &&
      same(proof.parent, parent.contractAddress) && same(proof.parentRuntimeHash, parent.runtimeBytecodeHash) &&
      same(proof.counter, counter.contractAddress) && same(proof.counterRuntimeHash, counter.runtimeBytecodeHash));
  });
};
export const isCurrentP2PPublicBookLinkAdmitted = (selected: typeof CURRENT_P2P_BINDING = CURRENT_P2P_BINDING): boolean =>
  selected.publicBookLinkAppState === 'active' && publicBookLinkQualified(selected);
export const isCurrentP2PPublicBookLinkRecoveryAdmitted = (selected: typeof CURRENT_P2P_BINDING = CURRENT_P2P_BINDING): boolean =>
  ['active', 'recovery'].includes(selected.publicBookLinkAppState) && publicBookLinkQualified(selected);

export type CurrentP2PTradeBalanceAdmission = Readonly<{
  protocol: TradeBalanceDisclosureProtocol; chainId: string; contractAddress: string; runtimeBytecodeHash: string;
  mode: 'held' | 'active'; variants: readonly TradeBalanceNativeVariant[]; proofSha256?: string;
  qualification?: TradeBalanceProof['nativeStatus']; nativeVariant?: TradeBalanceProof['nativeVariant']; producerProtocol?: TradeBalanceProof['producerProtocol'];
}>;
export const resolveCurrentP2PTradeBalanceAdmission = (protocol: TradeBalanceDisclosureProtocol, selected: typeof CURRENT_P2P_BINDING = CURRENT_P2P_BINDING): CurrentP2PTradeBalanceAdmission => {
  const deployment = selected.deployments[protocol], proofs = selected.tradeBalanceProofs.filter(proof => proof.protocol === protocol), proof = proofs[0];
  const same = (value: string, expected: string) => typeof value === 'string' && value.toLowerCase() === expected.toLowerCase();
  const supported = ['private-pair'];
  const qualified = proof?.nativeStatus === 'native-trade-balance-verified' && proof.nativeVariant === undefined && proof.producerProtocol === undefined ||
    proof?.nativeStatus === 'shared-native-variant-qualified' && (protocol === 'link-v2' && proof.nativeVariant === 'stored-ct' && proof.producerProtocol === 'private-v2' ||
      protocol === 'counter-v2' && proof.nativeVariant === 'caller-gt' && proof.producerProtocol === 'direct-v2');
  const admitted = selected.status !== 'prepared' && proofs.length === 1 && qualified && proof.appState === 'active' &&
    proofRecorded(proof.proofSha256) && proof.chainId === selected.chainId && deployment.chainId === selected.chainId && same(proof.genesisHash, selected.genesisHash) &&
    same(proof.contractAddress, deployment.contractAddress) && same(proof.runtimeBytecodeHash, deployment.runtimeBytecodeHash) &&
    proof.variants.length > 0 && new Set(proof.variants).size === proof.variants.length && proof.variants.every(variant => supported.includes(variant));
  return Object.freeze({ ...deployment, protocol, mode: admitted ? 'active' : 'held', variants: Object.freeze(admitted ? [...proof.variants] : []),
    ...(admitted ? { proofSha256: proof.proofSha256, qualification: proof.nativeStatus,
      ...(proof.nativeVariant ? { nativeVariant: proof.nativeVariant, producerProtocol: proof.producerProtocol } : {}) } : {}) });
};
export const assertCurrentP2PTradeBalanceAdmission = (
  deployment: Readonly<{ protocol: string; chainId: string; contractAddress: string; runtimeBytecodeHash: string }>,
  admission?: CurrentP2PTradeBalanceAdmission, variant?: TradeBalanceNativeVariant
): void => {
  if (!admission || admission.mode !== 'active' || admission.protocol !== deployment.protocol || admission.chainId !== deployment.chainId ||
      admission.contractAddress.toLowerCase() !== deployment.contractAddress.toLowerCase() || admission.runtimeBytecodeHash.toLowerCase() !== deployment.runtimeBytecodeHash.toLowerCase() ||
      !admission.variants.length || variant && !admission.variants.includes(variant)) throw new Error('Balance sharing is unavailable for this trade.');
};

export type CurrentP2PBookBudgetAdmission = Readonly<{
  chainId: string; contractAddress: string; runtimeBytecodeHash: string; mode: 'held' | 'active'; proofSha256?: string;
}>;
export const resolveCurrentP2PBookBudgetAdmission = (selected: typeof CURRENT_P2P_BINDING = CURRENT_P2P_BINDING): CurrentP2PBookBudgetAdmission => {
  const book = selected.deployments['private-v2'], proof = selected.bookBudgetProof;
  const same = (value: string | undefined, expected: string) => typeof value === 'string' && value.toLowerCase() === expected.toLowerCase();
  const admitted = selected.status !== 'prepared' && selected.bookBudgetAppState === 'active' &&
    selected.bookBudgetNativeStatus === 'native-book-budget-verified' && proof && proofRecorded(proof.proofSha256) &&
    book.chainId === selected.chainId && proof.chainId === selected.chainId && same(proof.genesisHash, selected.genesisHash) &&
    same(proof.book, book.contractAddress) && same(proof.bookRuntimeHash, book.runtimeBytecodeHash);
  return Object.freeze({ ...book, mode: admitted ? 'active' : 'held', ...(proofRecorded(proof?.proofSha256) ? { proofSha256: proof!.proofSha256 } : {}) });
};
export const isCurrentP2PBookBudgetAdmitted = (
  deployment: Readonly<{ chainId: string; contractAddress: string; runtimeBytecodeHash: string }>,
  admission: CurrentP2PBookBudgetAdmission = resolveCurrentP2PBookBudgetAdmission()
): boolean => admission.mode === 'active' && deployment.chainId === admission.chainId &&
  deployment.contractAddress.toLowerCase() === admission.contractAddress.toLowerCase() && deployment.runtimeBytecodeHash.toLowerCase() === admission.runtimeBytecodeHash.toLowerCase();
export const assertCurrentP2PBookBudgetActionAdmission = (
  deployment: Readonly<{ chainId: string; contractAddress: string; runtimeBytecodeHash: string }>, kind: string, admission: CurrentP2PBookBudgetAdmission
): void => {
  if (kind === 'budget-visibility' && !isCurrentP2PBookBudgetAdmitted(deployment, admission)) throw new Error('Budget visibility is unavailable.');
};

export type CurrentP2PDirectAdmission = Readonly<{
  chainId: string;
  contractAddress: string;
  runtimeBytecodeHash: string;
  mode: 'held' | 'private-forward' | 'public-forward' | 'full';
  privateCounter?: boolean;
  publicForward?: boolean;
  publicCounter?: boolean;
}>;

/** Candidate policy only. Owner capability, token policy and exact accounting remain required. */
export const resolveCurrentP2PDirectAdmission = (
  selected: typeof CURRENT_P2P_BINDING = CURRENT_P2P_BINDING
): CurrentP2PDirectAdmission => {
  const qualified = isCurrentP2PFinancialScopeQualified(selected);
  const full = qualified && selected.status === 'admitted';
  const privateForward = qualified && selected.status !== 'prepared' && selected.directPrivateVerified && selected.directAppActivated;
  const publicForward = qualified && selected.status !== 'prepared' && selected.directPublicVerified && selected.directPublicAppActivated;
  return Object.freeze({
    ...selected.deployments['direct-v2'],
    mode: full ? 'full' : privateForward ? 'private-forward' : publicForward ? 'public-forward' : 'held',
    privateCounter: full || (privateForward && selected.directPrivateCounterVerified && selected.directCounterAppActivated),
    publicForward: full || publicForward,
    publicCounter: full || (publicForward && selected.directPublicCounterVerified && selected.directPublicCounterAppActivated)
  });
};

const DIRECT_RECOVERY_ACTIONS = ['cancel', 'decline', 'reclaim-expired', 'withdraw-native-credit'];
const DIRECT_FORWARD_ACTIONS = ['create-private', 'accept-private'];
const DIRECT_PUBLIC_FORWARD_ACTIONS = ['create-public', 'accept-public'];
const DIRECT_OTHER_ACTIONS = ['create-public', 'accept-public', 'counter-private', 'counter-public', 'replace-private', 'replace-public'];

/** Keep unqualified candidate actions off the wallet; preserve explicit retained scopes and funded exits. */
export const assertCurrentP2PDirectActionAdmission = (
  deployment: Readonly<{ chainId: string; contractAddress: string; runtimeBytecodeHash: string }>,
  kind: string,
  admission: CurrentP2PDirectAdmission = resolveCurrentP2PDirectAdmission()
): void => {
  const matches = (scope: Readonly<{ chainId: string; contractAddress: string }>) =>
    deployment.chainId === scope.chainId && deployment.contractAddress.toLowerCase() === scope.contractAddress.toLowerCase();
  if (!matches(admission) && !matches(CURRENT_P2P_BINDING.deployments['direct-v2'])) return;
  if (!matches(admission) || deployment.runtimeBytecodeHash.toLowerCase() !== admission.runtimeBytecodeHash.toLowerCase()) {
    throw new Error('Direct candidate action policy and deployment differ.');
  }
  if (DIRECT_RECOVERY_ACTIONS.includes(kind)) return;
  if (admission.mode === 'full' && [...DIRECT_FORWARD_ACTIONS, ...DIRECT_OTHER_ACTIONS].includes(kind)) return;
  if (admission.mode === 'private-forward' && (DIRECT_FORWARD_ACTIONS.includes(kind) || kind === 'counter-private' && admission.privateCounter === true)) return;
  if (['private-forward', 'public-forward'].includes(admission.mode) && (
    DIRECT_PUBLIC_FORWARD_ACTIONS.includes(kind) && admission.publicForward === true || kind === 'counter-public' && admission.publicCounter === true
  )) return;
  throw new Error(admission.mode === 'held' ? 'Direct trading is waiting for App activation.' : 'This Direct action is not ready on the Testnet candidate.');
};

export const PRIVATE_BOOK_V2_RUNTIME_HASH = '0x9a55542e2174239860c063e33862b6f6875811f7a7674ce71a8d79ed51144b89';
export const isPrivateBookV2RuntimeHash = (hash: string): boolean => typeof hash === 'string' && (
  hash.toLowerCase() === PRIVATE_BOOK_V2_RUNTIME_HASH ||
  hash.toLowerCase() === CURRENT_P2P_BINDING.deployments['private-v2'].runtimeBytecodeHash ||
  CURRENT_P2P_BINDING.retainedBooks.some(book => book.runtimeBytecodeHash === hash.toLowerCase()) ||
  CURRENT_P2P_BINDING.retainedFinancialGraphs.some(graph => graph.deployments.some(manifest =>
    manifest.protocol === 'private-v2' && manifest.runtimeBytecodeHash.toLowerCase() === hash.toLowerCase()))
);
