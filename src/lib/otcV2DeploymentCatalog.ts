import type { TradeHistoryV2ManifestInput, TradeV2DeploymentProtocol } from './tradeHistoryV2Chain';
import { CURRENT_P2P_BINDING, CURRENT_P2P_PROTOCOLS, isCurrentP2PPrivateCounterAdmitted, isCurrentP2PPrivateCounterRecoveryAdmitted,
  isCurrentP2PFinancialScopeQualified,
  isCurrentP2PPublicBookLinkAdmitted, isCurrentP2PPublicBookLinkRecoveryAdmitted,
  resolveCurrentP2PDirectAdmission, resolveCurrentP2PBookBudgetAdmission, resolveCurrentP2PTradeBalanceAdmission, type CurrentP2PTradeBalanceAdmission,
  type TradeBalanceDisclosureProtocol, type CurrentP2PBookBudgetAdmission, type CurrentP2PDirectAdmission, type CurrentP2PProtocol } from './currentP2PBinding';
import type { TradeHistoryV2Protocol } from './tradeHistoryV2Ledger';
import {
  CHAINWHISPER_TESTNET_CANDIDATE_CONFIG,
  type TestnetCandidateConfig
} from './chainWhisperTestnetCandidate';

export const CURRENT_OTC_HISTORY_PROTOCOLS = ['standard-v2', 'private-v2', 'direct-v2'] as const;
export type CurrentOtcHistoryProtocol = typeof CURRENT_OTC_HISTORY_PROTOCOLS[number];

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
  fingerprint: string;
}>;

export type OtcV2DeploymentCatalog =
  | Readonly<{ status: 'inactive' }>
  | Readonly<{ status: 'invalid'; error: string }>
  | Readonly<{
      status: 'active';
      chainId: string;
      deployments: Readonly<Record<CurrentOtcHistoryProtocol, OtcV2Deployment>>;
      finalityLagBlocks: bigint;
      rpcUrl: string;
      fingerprint: string;
      preparedP2p?: PreparedP2PBinding;
    }>;

/** Selects the current P2P graph; action admission remains separate. */
export const resolveOtcV2DeploymentCatalog = (
  candidate: TestnetCandidateConfig,
  binding: typeof CURRENT_P2P_BINDING = CURRENT_P2P_BINDING
): OtcV2DeploymentCatalog => {
  if (candidate.status === 'inactive') return Object.freeze({ status: 'inactive' });
  if (candidate.status === 'invalid') {
    return Object.freeze({ status: 'invalid', error: 'OTC V2 testnet candidate is invalid.' });
  }
  try {
    if (candidate.chainId !== binding.chainId || !['prepared', 'book-admitted', 'admitted'].includes(binding.status)) throw new Error('P2P candidate chain or admission differs.');
    if (!isCurrentP2PFinancialScopeQualified(binding)) throw new Error('P2P financial repair qualification differs.');
    const fingerprint = `${candidate.fingerprint}:otc-v2-catalog:repair:${binding.repairQualification?.proofSha256 ?? ''}:${binding.repairQualification?.candidateSha256 ?? ''}`;
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
      fingerprint: `${fingerprint}:registered:${binding.sourceRecordSha256}:${binding.status}:direct:${directAdmission.mode}:${directAdmission.contractAddress}:${directAdmission.runtimeBytecodeHash}:${binding.deployments['direct-v2'].deploymentBlock}:private-counter:${directAdmission.privateCounter === true}:public-forward:${directAdmission.publicForward === true}:public-counter:${directAdmission.publicCounter === true}:external-private-counter:${privateCounterAdmitted}:counter-recovery:${privateCounterRecoveryAdmitted}:public-book-link:${binding.publicBookLinkAppState}:${publicBookLinkAdmitted}:${publicBookLinkRecoveryAdmitted}:${binding.publicBookLinkProofs.map(p => `${p.parentProtocol}:${p.forwardProofSha256}:${p.counterProofSha256}`).join(',')}:book-budget:${bookBudgetAdmission.mode}:${bookBudgetAdmission.contractAddress}:${bookBudgetAdmission.runtimeBytecodeHash}:${bookBudgetAdmission.proofSha256 ?? ''}:trade-balance:${Object.values(tradeBalanceAdmissions).map(a => `${a.protocol}:${a.mode}:${a.contractAddress}:${a.runtimeBytecodeHash}:${a.proofSha256 ?? ''}:${a.variants.join(',')}`).join(';')}`
    });
    return Object.freeze({
      status: 'active',
      chainId: candidate.chainId,
      deployments: Object.freeze(Object.fromEntries(CURRENT_OTC_HISTORY_PROTOCOLS.map(protocol =>
        [protocol, preparedP2p.deployments[protocol]]))) as Record<CurrentOtcHistoryProtocol, OtcV2Deployment>,
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
  return [...Object.values(catalog.deployments), ...Object.values(catalog.preparedP2p?.deployments ?? {})].find(
    deployment => deployment.manifest.contractAddress.toLowerCase() === contractAddress.toLowerCase()
  );
};
