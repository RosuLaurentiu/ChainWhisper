import type { TradeHistoryV2ManifestInput, TradeV2DeploymentProtocol } from './tradeHistoryV2Chain';
import { CURRENT_P2P_BINDING, CURRENT_P2P_PROTOCOLS, isCurrentP2PPrivateCounterAdmitted, isCurrentP2PPrivateCounterRecoveryAdmitted,
  isCurrentP2PFinancialScopeQualified, type RetainedP2PFinancialGraph,
  isCurrentP2PPublicBookLinkAdmitted, isCurrentP2PPublicBookLinkRecoveryAdmitted,
  resolveCurrentP2PDirectAdmission, resolveCurrentP2PBookBudgetAdmission, resolveCurrentP2PTradeBalanceAdmission, type CurrentP2PTradeBalanceAdmission,
  type TradeBalanceDisclosureProtocol, type CurrentP2PBookBudgetAdmission, type CurrentP2PDirectAdmission, type CurrentP2PProtocol } from './currentP2PBinding';
import type { TradeHistoryV2Protocol } from './tradeHistoryV2Ledger';
import {
  CHAINWHISPER_TESTNET_CANDIDATE_CONFIG,
  type ActiveTestnetCandidateConfig,
  type TestnetCandidateComponentKey,
  type TestnetCandidateConfig
} from './chainWhisperTestnetCandidate';

const OTC_V2_COMPONENTS = Object.freeze([
  ['standard-v2', 'standardOtcV2'],
  ['private-v2', 'privateOtcV2'],
  ['direct-v2', 'directOtcV2'],
  ['recurring-v2', 'recurringOtcV2'],
  ['private-recurring-v2', 'private-recurringOtcV2']
] as const satisfies readonly (readonly [TradeHistoryV2Protocol, TestnetCandidateComponentKey])[]);

export type OtcV2Deployment<P extends TradeV2DeploymentProtocol = TradeHistoryV2Protocol> = Readonly<{
  protocol: P;
  manifest: TradeHistoryV2ManifestInput<P> & Readonly<{
    protocol: P;
    chainId: string;
    contractAddress: string;
    deploymentBlock: string;
    runtimeBytecodeHash: string;
  }>;
  finalityLagBlocks: bigint;
  rpcUrl: string;
  fingerprint: string;
  retainedFinancialGraph?: RetainedP2PFinancialGraph;
}>;

export type PreparedP2PBinding = Readonly<{
  status: typeof CURRENT_P2P_BINDING.status;
  linkAdmitted: boolean;
  privateCounterAdmitted?: boolean;
  privateCounterRecoveryAdmitted?: boolean;
  publicBookLinkAdmitted?: boolean;
  publicBookLinkRecoveryAdmitted?: boolean;
  directAdmission: CurrentP2PDirectAdmission;
  bookBudgetAdmission?: CurrentP2PBookBudgetAdmission;
  tradeBalanceAdmissions?: Readonly<Partial<Record<TradeBalanceDisclosureProtocol, CurrentP2PTradeBalanceAdmission>>>;
  deployments: Readonly<{ [P in CurrentP2PProtocol]: OtcV2Deployment<P> }>;
  retainedDeployments: Readonly<Record<string, OtcV2Deployment<TradeV2DeploymentProtocol>>>;
  fingerprint: string;
}>;

export type OtcV2DeploymentCatalog =
  | Readonly<{ status: 'inactive' }>
  | Readonly<{ status: 'invalid'; error: string }>
  | Readonly<{
      status: 'active';
      chainId: string;
      deployments: Readonly<Record<TradeHistoryV2Protocol, OtcV2Deployment>>;
      finalityLagBlocks: bigint;
      rpcUrl: string;
      fingerprint: string;
      preparedP2p?: PreparedP2PBinding;
    }>;

const deploymentFor = (
  candidate: ActiveTestnetCandidateConfig,
  protocol: TradeHistoryV2Protocol,
  componentKey: TestnetCandidateComponentKey
): OtcV2Deployment => {
  const component = candidate.components[componentKey];
  if (!component.deploymentBlock) throw new Error('OTC V2 candidate deployment block is missing.');
  const manifest = Object.freeze({
    protocol,
    chainId: candidate.chainId,
    contractAddress: component.address,
    deploymentBlock: component.deploymentBlock,
    runtimeBytecodeHash: component.runtimeBytecodeHash
  });
  return Object.freeze({
    protocol,
    manifest,
    finalityLagBlocks: candidate.finalityLagBlocks,
    rpcUrl: candidate.rpcUrl,
    fingerprint: `${candidate.fingerprint}:otc-v2:${protocol}`
  });
};

/** Keeps the base suite and admits only the proven P2P scope. */
export const resolveOtcV2DeploymentCatalog = (
  candidate: TestnetCandidateConfig,
  binding: typeof CURRENT_P2P_BINDING = CURRENT_P2P_BINDING
): OtcV2DeploymentCatalog => {
  if (candidate.status === 'inactive') return Object.freeze({ status: 'inactive' });
  if (candidate.status === 'invalid') {
    return Object.freeze({ status: 'invalid', error: 'OTC V2 testnet candidate is invalid.' });
  }
  try {
    const deployments = Object.fromEntries(OTC_V2_COMPONENTS.map(([protocol, componentKey]) => [
      protocol,
      deploymentFor(candidate, protocol, componentKey)
    ])) as Record<TradeHistoryV2Protocol, OtcV2Deployment>;
    if (candidate.chainId !== binding.chainId || !['prepared', 'book-admitted', 'admitted'].includes(binding.status)) throw new Error('P2P candidate chain or admission differs.');
    if (!isCurrentP2PFinancialScopeQualified(binding)) throw new Error('P2P financial repair qualification differs.');
    const retainedFinancial = binding.retainedFinancialGraphs.flatMap(graph => {
      if (!/^[a-f0-9]{64}$/.test(graph.proofSha256) || !/^[a-f0-9]{64}$/.test(graph.previousBindingSha256) || graph.deployments.length !== 5 ||
          !CURRENT_P2P_PROTOCOLS.every(protocol => graph.deployments.filter(manifest => manifest.protocol === protocol && manifest.chainId === binding.chainId &&
            /^0x[0-9a-f]{40}$/.test(manifest.contractAddress) && /^0x[0-9a-f]{64}$/.test(manifest.runtimeBytecodeHash) && /^[1-9][0-9]*$/.test(manifest.deploymentBlock)).length === 1))
        throw new Error('Retained financial graph differs.');
      return graph.deployments.map(manifest => [manifest.contractAddress, Object.freeze({ protocol: manifest.protocol, manifest,
        retainedFinancialGraph: graph, finalityLagBlocks: candidate.finalityLagBlocks, rpcUrl: candidate.rpcUrl,
        fingerprint: `${candidate.fingerprint}:retained-graph:${graph.proofSha256}:${manifest.contractAddress}` })] as const);
    });
    const fingerprint = `${candidate.fingerprint}:otc-v2-catalog:repair:${binding.repairQualification?.proofSha256 ?? ''}:${binding.repairQualification?.candidateSha256 ?? ''}:retained:${binding.retainedFinancialGraphs.map(graph => `${graph.proofSha256}:${graph.previousBindingSha256}:${graph.deployments.map(manifest => `${manifest.protocol}:${manifest.contractAddress}:${manifest.runtimeBytecodeHash}`).join(',')}`).join(';')}`;
    const directAdmission = resolveCurrentP2PDirectAdmission(binding);
    const bookBudgetAdmission = resolveCurrentP2PBookBudgetAdmission(binding);
    const tradeBalanceAdmissions = Object.freeze(Object.fromEntries((['private-v2', 'direct-v2', 'link-v2', 'counter-v2'] as const)
      .map(protocol => [protocol, resolveCurrentP2PTradeBalanceAdmission(protocol, binding)]))) as NonNullable<PreparedP2PBinding['tradeBalanceAdmissions']>;
    const privateCounterAdmitted = isCurrentP2PPrivateCounterAdmitted(binding);
    const privateCounterRecoveryAdmitted = isCurrentP2PPrivateCounterRecoveryAdmitted(binding);
    const publicBookLinkAdmitted = isCurrentP2PPublicBookLinkAdmitted(binding);
    const publicBookLinkRecoveryAdmitted = isCurrentP2PPublicBookLinkRecoveryAdmitted(binding);
    const preparedP2p: PreparedP2PBinding = Object.freeze({
      status: binding.status,
      linkAdmitted: binding.status !== 'prepared' && binding.linkAdmitted,
      privateCounterAdmitted,
      privateCounterRecoveryAdmitted,
      publicBookLinkAdmitted,
      publicBookLinkRecoveryAdmitted,
      directAdmission,
      bookBudgetAdmission,
      tradeBalanceAdmissions,
      deployments: Object.freeze(Object.fromEntries(CURRENT_P2P_PROTOCOLS.map(protocol => [protocol, Object.freeze({
        protocol,
        manifest: binding.deployments[protocol],
        finalityLagBlocks: candidate.finalityLagBlocks,
        rpcUrl: candidate.rpcUrl,
        fingerprint: `${fingerprint}:registered:${binding.sourceRecordSha256}:${protocol}`
      })]))) as PreparedP2PBinding['deployments'],
      retainedDeployments: binding.status === 'prepared' ? Object.freeze(deployments) : Object.freeze({ ...deployments,
        ...Object.fromEntries([...binding.retainedBooks, ...binding.retainedLinks].map(manifest => [manifest.contractAddress, Object.freeze({
          protocol: manifest.protocol, manifest, finalityLagBlocks: candidate.finalityLagBlocks, rpcUrl: candidate.rpcUrl,
          fingerprint: `${fingerprint}:retained:${manifest.contractAddress}:${manifest.runtimeBytecodeHash}`
        })])), ...Object.fromEntries(retainedFinancial) }),
      fingerprint: `${fingerprint}:registered:${binding.sourceRecordSha256}:${binding.status}:direct:${directAdmission.mode}:${directAdmission.contractAddress}:${directAdmission.runtimeBytecodeHash}:${binding.deployments['direct-v2'].deploymentBlock}:private-counter:${directAdmission.privateCounter === true}:public-forward:${directAdmission.publicForward === true}:public-counter:${directAdmission.publicCounter === true}:external-private-counter:${privateCounterAdmitted}:counter-recovery:${privateCounterRecoveryAdmitted}:public-book-link:${binding.publicBookLinkAppState}:${publicBookLinkAdmitted}:${publicBookLinkRecoveryAdmitted}:${binding.publicBookLinkProofs.map(p => `${p.parentProtocol}:${p.forwardProofSha256}:${p.counterProofSha256}`).join(',')}:book-budget:${bookBudgetAdmission.mode}:${bookBudgetAdmission.contractAddress}:${bookBudgetAdmission.runtimeBytecodeHash}:${bookBudgetAdmission.proofSha256 ?? ''}:trade-balance:${Object.values(tradeBalanceAdmissions).map(a => `${a.protocol}:${a.mode}:${a.contractAddress}:${a.runtimeBytecodeHash}:${a.proofSha256 ?? ''}:${a.variants.join(',')}`).join(';')}`
    });
    return Object.freeze({
      status: 'active',
      chainId: candidate.chainId,
      deployments: binding.status === 'admitted' ? Object.freeze({ ...deployments,
        'standard-v2': preparedP2p.deployments['standard-v2'],
        'private-v2': preparedP2p.deployments['private-v2'],
        'direct-v2': preparedP2p.deployments['direct-v2'] }) : binding.status === 'book-admitted'
          ? Object.freeze({ ...deployments, 'private-v2': preparedP2p.deployments['private-v2'],
            ...(publicBookLinkRecoveryAdmitted ? { 'standard-v2': preparedP2p.deployments['standard-v2'] } : {}),
            ...(['private-forward', 'public-forward'].includes(directAdmission.mode) ? { 'direct-v2': preparedP2p.deployments['direct-v2'] } : {}) }) : Object.freeze(deployments),
      finalityLagBlocks: candidate.finalityLagBlocks,
      rpcUrl: candidate.rpcUrl,
      fingerprint: binding.status !== 'prepared' ? preparedP2p.fingerprint : fingerprint,
      preparedP2p
    });
  } catch {
    return Object.freeze({ status: 'invalid', error: 'OTC V2 testnet candidate is invalid.' });
  }
};

export const OTC_V2_DEPLOYMENT_CATALOG = resolveOtcV2DeploymentCatalog(
  CHAINWHISPER_TESTNET_CANDIDATE_CONFIG
);

/** Identifies a route; a prepared match does not grant a reader or write capability. */
export const findOtcV2Deployment = (catalog: OtcV2DeploymentCatalog, chainId: string, contractAddress: string): OtcV2Deployment<TradeV2DeploymentProtocol> | undefined => {
  if (catalog.status !== 'active' || catalog.chainId !== chainId) return undefined;
  return [...Object.values(catalog.deployments), ...Object.values(catalog.preparedP2p?.deployments ?? {}), ...Object.values(catalog.preparedP2p?.retainedDeployments ?? {})].find(
    deployment => deployment.manifest.contractAddress.toLowerCase() === contractAddress.toLowerCase()
  );
};
