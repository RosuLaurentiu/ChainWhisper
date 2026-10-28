import {
  confirmDirectTradeV2Action,
  ensureDirectTradeV2ActionAllowance,
  readDirectTradeV2TradeIds,
  readDirectTradeV2TradeTerms,
  submitDirectTradeV2Action,
  type ConfirmedDirectTradeV2Action,
  type DirectTradeV2Action,
  type DirectTradeV2TradeIdPage,
  type DirectTradeV2TradeTerms
} from './directTradeV2Actions';
import { assertCurrentP2PDirectActionAdmission, assertCurrentP2PBookBudgetActionAdmission, isCurrentP2PBookBudgetAdmitted,
  assertCurrentP2PTradeBalanceAdmission, type CurrentP2PTradeBalanceAdmission, type TradeBalanceDisclosureProtocol,
  type CurrentP2PBookBudgetAdmission, type CurrentP2PDirectAdmission } from './currentP2PBinding';
import {
  assertOtcTradeHistoryV2Runtime,
  type OtcTradeHistoryV2Runtime
} from './otcTradeHistoryV2Runtime';
import type { OwnerTradeV2MetaMaskCapability } from './ownerTradeV2Capability';
import { assertOwnerTradeV2CapabilitySnapshotCurrent, getOwnerTradeV2CapabilityBinding } from './ownerTradeV2Capability';
import { assertCounterTradeV2ModeAdmission, readCounterTradeV2Proposal, type CounterTradeV2Deployment, type CounterTradeV2Amounts, type CounterTradeV2Material, type CounterTradeV2Proposal, type CounterTradeV2Parent, type CounterTradeV2ParentDeployment } from './counterTradeV2';
import { createCounterTradeV2ActivityReader, mergeCounterTradeV2ActivitySnapshots, type CounterTradeV2ActivitySnapshot, type CounterTradeV2ActivityOrder } from './counterTradeV2Activity';
import { readTradeBalanceDisclosureV2, executeTradeBalanceDisclosureV2, readTradeBalanceDisclosureV2Pending,
  reconcileTradeBalanceDisclosureV2, readTradeBalanceDisclosureV2Recipients, type TradeBalanceDisclosureV2Runtime, type TradeBalanceDisclosureV2Input } from './tradeBalanceDisclosureV2';
import { executeCounterTradeV2Proposal, continueCounterTradeV2Proposal, cancelCounterTradeV2Proposal,
  cleanupCounterTradeV2Allowance, reconcileCounterTradeV2Proposal, executeCounterTradeV2RecipientAction } from './counterTradeV2Flow';
import { createLinkTradeV2CreationJournal, createPrivateBookV2Journal, type CounterTradeV2Recovery } from './linkTradeV2CreationJournal';
import type { OtcV2Deployment, OtcV2DeploymentCatalog } from './otcV2DeploymentCatalog';
import {
  executePrivateTradeV2Action,
  readPrivateTradeV2AccountSnapshot,
  readPrivateTradeV2OrderIds,
  readPrivateTradeV2OrderView,
  type ConfirmedPrivateTradeV2Action,
  type PrivateTradeV2AccountSnapshot,
  type PrivateTradeV2Action,
  type PrivateTradeV2OrderIdPage,
  type PrivateTradeV2OrderView
} from './privateTradeV2Actions';
import {
  confirmPrivateRecurringTradeV2Action,
  readPrivateRecurringTradeV2ExecutionReceipt,
  readPrivateRecurringTradeV2MakerInventory,
  readPrivateRecurringTradeV2OrderIds,
  readPrivateRecurringTradeV2OrderView,
  submitPrivateRecurringTradeV2Action,
  type ConfirmedPrivateRecurringTradeV2Action,
  type PrivateRecurringTradeV2ExecutionReceipt,
  type PrivateRecurringTradeV2Inventory,
  type PrivateRecurringTradeV2Action,
  type PrivateRecurringTradeV2OrderIdPage,
  type PrivateRecurringTradeV2OrderView
} from './privateRecurringTradeV2Actions';
import {
  confirmRecurringTradeV2Action,
  quoteRecurringTradeV2Execution,
  readRecurringTradeV2OrderIds,
  readRecurringTradeV2OrderView,
  submitRecurringTradeV2Action,
  type ConfirmedRecurringTradeV2Action,
  type RecurringTradeV2Action,
  type RecurringTradeV2OrderIdPage,
  type RecurringTradeV2OrderView,
  type RecurringTradeV2Quote
} from './recurringTradeV2Actions';
import {
  confirmStandardTradeV2Action,
  ensureStandardTradeV2Allowance,
  quoteStandardTradeV2Fill,
  readStandardTradeV2Ids,
  readStandardTradeV2View,
  submitStandardTradeV2Action,
  type ConfirmedStandardTradeV2Action,
  type StandardTradeV2Action,
  type StandardTradeV2IdPage,
  type StandardTradeV2Quote,
  type StandardTradeV2View
} from './standardTradeV2Actions';
import { captureWalletActionIntent, readWalletActionIntent } from './walletActionIntent';
import { executeLinkTradeV2Creation, reconcileLinkTradeV2Creation, continueLinkTradeV2Creation,
  type LinkTradeV2CreationAction, type LinkTradeV2CreationRecoveryJournal, type LinkTradeV2CreationRecord } from './linkTradeV2CreationFlow';
import type { LinkTradeV2Deployment, LinkTradeV2Review } from './linkTradeV2';
import { executeLinkTradeV2Fill, reconcileLinkTradeV2Fill, continueLinkTradeV2Fill } from './linkTradeV2FillFlow';
import { createLinkTradeV2ActivityReader, mergeLinkTradeV2ActivitySnapshots, type LinkTradeV2ActivitySnapshot } from './linkTradeV2Activity';
import { normalizeLinkTradeV2Reference, type LinkTradeV2Reference, type LinkTradeV2Terms } from './linkTradeV2Terms';
import { readLinkTradeV2OwnerOrder, executeLinkTradeV2OwnerOrderAction, cleanupLinkTradeV2Creation,
  reconcileLinkTradeV2OwnerAction, retryLinkTradeV2OwnerAction } from './linkTradeV2OwnerActions';
import { assertAttestedTradeHistoryV2Deployment, attestTradeHistoryV2Deployment, attestTradeHistoryV2Deployments, TRADE_HISTORY_V2_MAX_PARTICIPANT_LOG_RANGE_BLOCKS, type AttestedTradeHistoryV2Deployment, type TradeHistoryV2ReadCapability } from './tradeHistoryV2Chain';
import type { TradeHistoryV2OrderRef } from './tradeHistoryV2Ledger';
import { isPrivateBookV2RuntimeHash, executePrivateBookV2Action, reconcilePrivateBookV2Action, readPrivateBookV2PreparedAction, cleanupPrivateBookV2Preparation, readPrivateBookV2OrderIds, readPrivateBookV2OrderView, readPrivateBookV2AccountSnapshot, type PrivateBookV2Action, type PrivateBookV2OrderView, type PrivateBookV2AccountSnapshot, type PrivateBookV2OrderIdPage, type ConfirmedPrivateBookV2Action } from './privateBookV2Actions';

declare const OTC_V2_ACTION_RUNTIME_BRAND: unique symbol;
export type LinkTradeV2CreationStatus = Readonly<{
  id: string; active: boolean; feeWei: string; terms?: LinkTradeV2Terms; offerBudget?: string;
  last?: LinkTradeV2CreationRecord; canContinue: boolean;
  canCleanup?: boolean; canRetry?: boolean;
  fill?: Readonly<{ reference: LinkTradeV2Review['reference']; maximumPayment: string }>;
  ownerAction?: Readonly<{ kind: 'cancel' | 'cleanup'; orderId?: string; offerToken: string; privatePair: boolean }>;
}>;
export type OtcV2ActionRuntime = Readonly<{
  tradeBalances: Readonly<Partial<Record<TradeBalanceDisclosureProtocol, TradeBalanceDisclosureV2Runtime>>>;
  resolveLinkReadContext?(reference: LinkTradeV2Reference): Promise<Readonly<{
    capability: TradeHistoryV2ReadCapability; deployment: LinkTradeV2Deployment;
  }>>;
  counter?: Readonly<{
    ownerAddress: string;
    readContext: Readonly<{ capability: TradeHistoryV2ReadCapability; deployment: CounterTradeV2Deployment }>;
    forReference?(reference: Pick<CounterTradeV2ActivityOrder, 'chainId' | 'escrow' | 'id'>): Promise<NonNullable<OtcV2ActionRuntime['counter']>>;
    privateOnly?: boolean;
    publicOnly?: boolean;
    recoveryOnly?: boolean;
    balance?: TradeBalanceDisclosureV2Runtime;
    propose(parent: CounterTradeV2Parent, amounts: CounterTradeV2Amounts): ReturnType<typeof executeCounterTradeV2Proposal>;
    read(proposalId: string): ReturnType<typeof readCounterTradeV2Proposal>;
    cancel(proposalId: string): ReturnType<typeof cancelCounterTradeV2Proposal>;
    recipientAction(proposal: CounterTradeV2Proposal, kind: 'accept' | 'decline'): ReturnType<typeof executeCounterTradeV2RecipientAction>;
    syncActivity(): Promise<CounterTradeV2ActivitySnapshot>;
    cleanup(): ReturnType<typeof cleanupCounterTradeV2Allowance>;
    continue(recoveryId: string): ReturnType<typeof continueCounterTradeV2Proposal>;
    reconcile(transactionHash?: string): ReturnType<typeof reconcileCounterTradeV2Proposal>;
    readRecovery(): Promise<Readonly<{ id: string; active: boolean; feeWei: string; material: CounterTradeV2Material;
      kind: CounterTradeV2Recovery['kind']; last?: LinkTradeV2CreationRecord; canContinue: boolean; canCleanup: boolean }> | null>;
  }>;
  link?: Readonly<{
    ownerAddress: string;
    balance?: TradeBalanceDisclosureV2Runtime;
    readContext: Readonly<{ capability: TradeHistoryV2ReadCapability; deployment: LinkTradeV2Deployment }>;
    forReference?(reference: LinkTradeV2Reference): Promise<NonNullable<OtcV2ActionRuntime['link']>>;
    create(action: LinkTradeV2CreationAction): ReturnType<typeof executeLinkTradeV2Creation>;
    fill(review: LinkTradeV2Review, maximumPayment: string): ReturnType<typeof executeLinkTradeV2Fill>;
    reconcileFill(transactionHash?: string): ReturnType<typeof reconcileLinkTradeV2Fill>;
    continueFill(fillId: string): ReturnType<typeof continueLinkTradeV2Fill>;
    syncActivity(): Promise<LinkTradeV2ActivitySnapshot>;
    readCreation(): Promise<LinkTradeV2CreationStatus | null>;
    reconcileCreation(transactionHash?: string): ReturnType<typeof reconcileLinkTradeV2Creation>;
    continueCreation(creationId: string): ReturnType<typeof continueLinkTradeV2Creation>;
    discardDraft(creationId: string): Promise<void>;
    readOwnerOrder(orderId: string): ReturnType<typeof readLinkTradeV2OwnerOrder>;
    ownerOrderAction(action: { orderId: string; kind: 'cancel' | 'cleanup' }): ReturnType<typeof executeLinkTradeV2OwnerOrderAction>;
    cleanupCreation(creationId: string): ReturnType<typeof cleanupLinkTradeV2Creation>;
    reconcileOwnerAction(transactionHash?: string): ReturnType<typeof reconcileLinkTradeV2OwnerAction>;
    retryOwnerAction(actionId: string): ReturnType<typeof retryLinkTradeV2OwnerAction>;
  }>;
  privateBook?: Readonly<{
    ownerAddress: string;
    budgetVisibilityAvailable: boolean;
    execute(action: PrivateBookV2Action): Promise<ConfirmedPrivateBookV2Action>;
    readRecovery(): ReturnType<ReturnType<typeof createPrivateBookV2Journal>['read']>;
    reconcile(transactionHash?: string): ReturnType<typeof reconcilePrivateBookV2Action>;
    readPreparedAction(): Promise<PrivateBookV2Action | undefined>;
    discardPreparation(id: string): Promise<void>;
    cleanupPreparation(id: string): Promise<void>;
    list(scope: 'maker' | 'filler' | 'open', offset?: bigint, limit?: bigint): Promise<PrivateBookV2OrderIdPage>;
    read(orderId: bigint | number | string): Promise<PrivateBookV2OrderView>;
    readAccount(orderId: bigint | number | string): Promise<PrivateBookV2AccountSnapshot>;
  }>;
  readonly [OTC_V2_ACTION_RUNTIME_BRAND]: true;
  direct(action: DirectTradeV2Action): Promise<ConfirmedDirectTradeV2Action>;
  privateRecurring(action: PrivateRecurringTradeV2Action): Promise<ConfirmedPrivateRecurringTradeV2Action>;
  privateTrade(action: PrivateTradeV2Action): Promise<ConfirmedPrivateTradeV2Action>;
  recurring(action: RecurringTradeV2Action): Promise<ConfirmedRecurringTradeV2Action>;
  standard(action: StandardTradeV2Action): Promise<ConfirmedStandardTradeV2Action>;
  listStandard(scope: 'recent' | 'maker' | 'filler' | 'open', offset?: bigint, limit?: bigint): Promise<StandardTradeV2IdPage>;
  readStandard(tradeId: bigint | number | string): Promise<StandardTradeV2View>;
  quoteStandard(tradeId: bigint | number | string, requestAmountIn: bigint | number | string): Promise<StandardTradeV2Quote>;
  listPrivateTrade(scope: 'maker' | 'filler' | 'open', offset?: bigint, limit?: bigint): Promise<PrivateTradeV2OrderIdPage>;
  readPrivateTrade(orderId: bigint | number | string): Promise<PrivateTradeV2OrderView>;
  readPrivateTradeAccount(orderId: bigint | number | string): Promise<PrivateTradeV2AccountSnapshot>;
  listDirect(scope: 'maker' | 'taker' | 'counter', offset?: bigint, limit?: bigint, parentTradeId?: bigint | number | string): Promise<DirectTradeV2TradeIdPage>;
  readDirect(tradeId: bigint | number | string, decryptPrivateAmounts?: boolean): Promise<DirectTradeV2TradeTerms>;
  listRecurring(scope: 'recent' | 'maker' | 'filler' | 'active', offset?: bigint, limit?: bigint): Promise<RecurringTradeV2OrderIdPage>;
  readRecurring(orderId: bigint | number | string): Promise<RecurringTradeV2OrderView>;
  quoteRecurring(orderId: bigint | number | string, side: 'buy' | 'sell', maxInputAmount: bigint | number | string): Promise<RecurringTradeV2Quote>;
  listPrivateRecurring(scope: 'maker' | 'filler' | 'active', offset?: bigint, limit?: bigint): Promise<PrivateRecurringTradeV2OrderIdPage>;
  readPrivateRecurring(orderId: bigint | number | string): Promise<PrivateRecurringTradeV2OrderView>;
  readPrivateRecurringInventory(orderId: bigint | number | string): Promise<PrivateRecurringTradeV2Inventory>;
  readPrivateRecurringReceipt(orderId: bigint | number | string): Promise<PrivateRecurringTradeV2ExecutionReceipt>;
  deployments: OtcTradeHistoryV2Runtime['deployments'];
  retainedDeployments?: OtcTradeHistoryV2Runtime['retainedDeployments'];
  forReference?(reference: TradeHistoryV2OrderRef): Promise<OtcV2ActionRuntime>;
  isCurrent(): boolean;
  close(): void;
}>;

const ACTION_RUNTIMES = new WeakSet<object>();

export const createOtcV2ActionRuntime = ({
  history,
  getOwnerCapability,
  runOwnerTransactionFlow,
  linkCreation: linkCreationInput,
  counterCreation: counterCreationInput,
  directAdmission,
  bookBudgetAdmission,
  tradeBalanceAdmissions = {},
  standardAdmission = 'full',
  deploymentOverride,
  deploymentOverrides,
  resolveReference,
  resolveLinkReadContext,
  resolveLinkRuntime,
  readRetainedLinkActivity,
  readRetainedCounterActivity,
  onClose
}: {
  history: OtcTradeHistoryV2Runtime;
  getOwnerCapability: (requirePrivacy: boolean) => Promise<OwnerTradeV2MetaMaskCapability>;
  runOwnerTransactionFlow: <T>(operation: () => Promise<T>) => Promise<T>;
  // Supply only after the complete Link graph and its persistent recovery journal are admitted.
  linkCreation?: Readonly<{ capability: TradeHistoryV2ReadCapability; deployment: LinkTradeV2Deployment; journal: LinkTradeV2CreationRecoveryJournal; privateOnly?: boolean; recoveryOnly?: boolean }>;
  counterCreation?: Readonly<{ deployment: CounterTradeV2Deployment; journal: ReturnType<typeof createLinkTradeV2CreationJournal>; privateOnly?: boolean; publicOnly?: boolean; recoveryOnly?: boolean }>;
  directAdmission?: CurrentP2PDirectAdmission;
  bookBudgetAdmission?: CurrentP2PBookBudgetAdmission;
  tradeBalanceAdmissions?: Readonly<Partial<Record<TradeBalanceDisclosureProtocol, CurrentP2PTradeBalanceAdmission>>>;
  standardAdmission?: 'recovery' | 'forward' | 'full';
  deploymentOverride?: AttestedTradeHistoryV2Deployment;
  deploymentOverrides?: readonly AttestedTradeHistoryV2Deployment[];
  resolveReference?: (reference: TradeHistoryV2OrderRef) => Promise<OtcV2ActionRuntime>;
  resolveLinkReadContext?: NonNullable<OtcV2ActionRuntime['resolveLinkReadContext']>;
  resolveLinkRuntime?: (reference: LinkTradeV2Reference) => Promise<NonNullable<OtcV2ActionRuntime['link']>>;
  readRetainedLinkActivity?: () => Promise<readonly LinkTradeV2ActivitySnapshot[]>;
  readRetainedCounterActivity?: () => Promise<readonly CounterTradeV2ActivitySnapshot[]>;
  onClose?: () => void;
}): OtcV2ActionRuntime => {
  const verifiedHistory = assertOtcTradeHistoryV2Runtime(history);
  if (deploymentOverride) {
    assertAttestedTradeHistoryV2Deployment(deploymentOverride, deploymentOverride.protocol);
    if (deploymentOverride.chainId !== verifiedHistory.deployments['standard-v2'].chainId) throw new Error('Retained deployment and history chains differ.');
  }
  for (const deployment of deploymentOverrides ?? []) {
    assertAttestedTradeHistoryV2Deployment(deployment, deployment.protocol);
    if (deployment.chainId !== verifiedHistory.deployments['standard-v2'].chainId) throw new Error('Retained deployment and history chains differ.');
  }
  const deployments = deploymentOverride || deploymentOverrides ? Object.freeze({ ...verifiedHistory.deployments,
    ...Object.fromEntries((deploymentOverrides ?? []).map(deployment => [deployment.protocol, deployment])),
    ...(deploymentOverride ? { [deploymentOverride.protocol]: deploymentOverride } : {}) }) : verifiedHistory.deployments;
  const budgetAdmission: CurrentP2PBookBudgetAdmission = bookBudgetAdmission ?? Object.freeze({ ...deployments['private-v2'], mode: 'held' });
  const linkCreation = linkCreationInput && Object.freeze({ capability: linkCreationInput.capability,
    deployment: linkCreationInput.deployment, journal: Object.freeze({ ...linkCreationInput.journal }),
    privateOnly: linkCreationInput.privateOnly === true, recoveryOnly: linkCreationInput.recoveryOnly === true });
  const counterCreation = counterCreationInput && Object.freeze({ deployment: counterCreationInput.deployment,
    journal: Object.freeze({ ...counterCreationInput.journal }), privateOnly: counterCreationInput.privateOnly === true,
    publicOnly: counterCreationInput.publicOnly === true, recoveryOnly: counterCreationInput.recoveryOnly === true });
  if (linkCreation) {
    assertAttestedTradeHistoryV2Deployment(linkCreation.deployment, 'link-v2');
    if (linkCreation.deployment.chainId !== deployments['standard-v2'].chainId) throw new Error('Link creation and the OTC suite use different chains.');
  }
  const counterParents = Object.freeze([
    ...(linkCreation ? [linkCreation.deployment] : []),
    ...(isPrivateBookV2RuntimeHash(deployments['private-v2'].runtimeBytecodeHash) ? [deployments['private-v2'] as AttestedTradeHistoryV2Deployment<'private-v2'>] : []),
    deployments['standard-v2'] as AttestedTradeHistoryV2Deployment<'standard-v2'>
  ] satisfies CounterTradeV2ParentDeployment[]);
  if (counterCreation) {
    assertAttestedTradeHistoryV2Deployment(counterCreation.deployment, 'counter-v2');
    if (!counterParents.length || counterParents.some(parent => parent.chainId !== counterCreation.deployment.chainId)) throw new Error('Counter requires an admitted parent on the same chain.');
    counterParents.forEach(parent => assertAttestedTradeHistoryV2Deployment(parent, parent.protocol));
  }
  if (typeof getOwnerCapability !== 'function' || typeof runOwnerTransactionFlow !== 'function') {
    throw new Error('OTC V2 action runtime dependencies are unavailable.');
  }
  const assertLegacyPrivateApi = () => {
    if (isPrivateBookV2RuntimeHash(deployments['private-v2'].runtimeBytecodeHash)) {
      throw new Error('Use the promoted private book review and action API for this runtime.');
    }
  };
  let alive = true;
  let linkActivity: ReturnType<typeof createLinkTradeV2ActivityReader> | undefined;
  let counterActivity: ReturnType<typeof createCounterTradeV2ActivityReader> | undefined;
  let bookJournal: ReturnType<typeof createPrivateBookV2Journal> | undefined;
  let bookCapability: OwnerTradeV2MetaMaskCapability | undefined;
  const getBookJournal = (capability: OwnerTradeV2MetaMaskCapability) => {
    if (!bookJournal || bookCapability !== capability) {
      bookJournal?.close();
      bookJournal = createPrivateBookV2Journal({ capability, deployment: deployments['private-v2'] as AttestedTradeHistoryV2Deployment<'private-v2'> });
      bookCapability = capability;
    }
    return bookJournal;
  };
  let operationTail = Promise.resolve();

  const exclusive = async <T>(requirePrivacy: boolean, operation: (
    capability: OwnerTradeV2MetaMaskCapability
  ) => Promise<T>): Promise<T> => {
    const previous = operationTail;
    let release = () => {};
    operationTail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      if (!alive || !verifiedHistory.isCurrent()) throw new Error('OTC V2 action runtime is closed.');
      return await runOwnerTransactionFlow(async () => {
        if (!alive || !verifiedHistory.isCurrent()) throw new Error('OTC V2 action runtime is closed.');
        const capability = await getOwnerCapability(requirePrivacy);
        if (!alive || !verifiedHistory.isCurrent()) throw new Error('OTC V2 action runtime closed before submission.');
        return operation(capability);
      });
    } finally {
      release();
    }
  };

  const readExclusive = async <T>(requirePrivacy: boolean, operation: (
    capability: OwnerTradeV2MetaMaskCapability
  ) => Promise<T>): Promise<T> => {
    const previous = operationTail;
    let release = () => {};
    operationTail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      if (!alive || !verifiedHistory.isCurrent()) throw new Error('OTC V2 action runtime is closed.');
      const capability = await getOwnerCapability(requirePrivacy);
      if (!alive || !verifiedHistory.isCurrent()) throw new Error('OTC V2 action runtime closed during a read.');
      return await operation(capability);
    } finally {
      release();
    }
  };

  // Each runtime owns its history queue. Retained child runtimes must keep theirs separate.
  let activityTail = Promise.resolve();
  const readActivity = async <T>(operation: (capability: OwnerTradeV2MetaMaskCapability) => Promise<T>): Promise<T> => {
    const previous = activityTail;
    let release = () => {};
    activityTail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      if (!alive || !verifiedHistory.isCurrent()) throw new Error('OTC V2 activity runtime is closed.');
      // Keep capability acquisition on the owner queue, then release it before the slow scan.
      const capability = await readExclusive(true, async current => current);
      await assertOwnerTradeV2CapabilitySnapshotCurrent(capability);
      if (!alive || !verifiedHistory.isCurrent()) throw new Error('OTC V2 activity runtime closed before a scan.');
      const result = await operation(capability);
      await assertOwnerTradeV2CapabilitySnapshotCurrent(capability);
      if (!alive || !verifiedHistory.isCurrent()) throw new Error('OTC V2 activity runtime closed during a scan.');
      return result;
    } finally {
      release();
    }
  };

  const counterContext = (capability: OwnerTradeV2MetaMaskCapability) => {
    if (!counterCreation || !counterParents.length || getOwnerTradeV2CapabilityBinding(capability).ownerAddress.toLowerCase() !== verifiedHistory.ownerAddress.toLowerCase()) throw new Error('Counter owner or deployment is unavailable.');
    return { capability, readCapability: linkCreation?.capability ?? verifiedHistory.readCapability, deployment: counterCreation.deployment,
      parentDeployment: counterParents[0], parentDeployments: counterParents, journal: counterCreation.journal,
      privateOnly: counterCreation.privateOnly, publicOnly: counterCreation.publicOnly, recoveryOnly: counterCreation.recoveryOnly };
  };
  const assertLinkFundingMode = (privatePair?: boolean): void => {
    if (linkCreation?.recoveryOnly) throw new Error('Retained Link permits recovery only.');
    if (linkCreation?.privateOnly && privatePair !== true) throw new Error('Public Link trading is waiting for App activation.');
  };
  const assertSavedLinkFundingMode = async (kind: 'create' | 'fill'): Promise<void> => {
    if (linkCreation?.recoveryOnly) throw new Error('Retained Link permits recovery only.');
    if (!linkCreation?.privateOnly) return;
    const saved = await linkCreation.journal.read();
    const terms = kind === 'create' ? saved?.recovery?.terms : saved?.fill?.terms;
    if (!terms) throw new Error('Saved Link funding terms are unavailable.');
    assertLinkFundingMode(terms.privatePair);
  };
  const disclosureJournals = new Set<TradeBalanceDisclosureV2Input['journal']>();
  const balanceRuntime = (deployment: TradeBalanceDisclosureV2Input['deployment']): TradeBalanceDisclosureV2Runtime => {
    let journal: TradeBalanceDisclosureV2Input['journal'] | undefined, journalCapability: OwnerTradeV2MetaMaskCapability | undefined;
    const admission = tradeBalanceAdmissions[deployment.protocol];
    let available = false;
    try { assertCurrentP2PTradeBalanceAdmission(deployment, admission); available = true; } catch { /* Unproved targets stay held. */ }
    const requireAdmission = () => assertCurrentP2PTradeBalanceAdmission(deployment, admission);
    const context = (capability: OwnerTradeV2MetaMaskCapability): TradeBalanceDisclosureV2Input => {
      if (getOwnerTradeV2CapabilityBinding(capability).ownerAddress.toLowerCase() !== verifiedHistory.ownerAddress.toLowerCase()) throw new Error('Trade-balance owner changed.');
      if (!journal || journalCapability !== capability) {
        journal?.close?.(); journal = createLinkTradeV2CreationJournal({ capability, deployment, purpose: 'disclosure' });
        journalCapability = capability; disclosureJournals.add(journal);
      }
      return { capability, readCapability: linkCreation?.capability ?? verifiedHistory.readCapability, deployment, journal, admission };
    };
    return Object.freeze({ ownerAddress: verifiedHistory.ownerAddress, available,
      read: (orderId: string, recipient?: string) => { requireAdmission(); return readExclusive(true, capability => readTradeBalanceDisclosureV2({ ...context(capability), orderId, recipient })); },
      execute: (action: Parameters<TradeBalanceDisclosureV2Runtime['execute']>[0]) => { const captured = captureWalletActionIntent(action);
        requireAdmission();
        return exclusive(true, capability => executeTradeBalanceDisclosureV2({ ...context(capability), ...readWalletActionIntent(captured) })); },
      pending: (orderId?: string) => readExclusive(true, capability => readTradeBalanceDisclosureV2Pending({ ...context(capability), orderId })),
      reconcile: (transactionHash?: string) => readExclusive(true, capability => reconcileTradeBalanceDisclosureV2({ ...context(capability), transactionHash })),
      recipients: (orderId: string, cursor?: Readonly<{ number: string; hash: string }>) => { requireAdmission(); const captured = cursor && Object.freeze({ ...cursor });
        return readExclusive(true, capability => readTradeBalanceDisclosureV2Recipients({ ...context(capability), orderId, cursor: captured })); }
    });
  };
  const tradeBalances: Partial<Record<TradeBalanceDisclosureProtocol, TradeBalanceDisclosureV2Runtime>> = {
    ...(isPrivateBookV2RuntimeHash(deployments['private-v2'].runtimeBytecodeHash) ? { 'private-v2': balanceRuntime(deployments['private-v2'] as TradeBalanceDisclosureV2Input['deployment']) } : {}),
    'direct-v2': balanceRuntime(deployments['direct-v2'] as TradeBalanceDisclosureV2Input['deployment']),
    ...(linkCreation ? { 'link-v2': balanceRuntime(linkCreation.deployment) } : {}),
    ...(counterCreation ? { 'counter-v2': balanceRuntime(counterCreation.deployment) } : {})
  };
  const runtime = Object.freeze({
    tradeBalances: Object.freeze(tradeBalances),
    ...(counterCreation ? { counter: Object.freeze({
      ownerAddress: verifiedHistory.ownerAddress,
      readContext: Object.freeze({ capability: linkCreation?.capability ?? verifiedHistory.readCapability, deployment: counterCreation.deployment }),
      forReference: async (reference: Pick<CounterTradeV2ActivityOrder, 'chainId' | 'escrow' | 'id'>) => {
        const selected = await runtime.forReference!({ chainId: reference.chainId, contractAddress: reference.escrow, orderId: reference.id });
        const target = selected.counter, deployment = target?.readContext.deployment;
        if (!target || !deployment || deployment.chainId !== reference.chainId || deployment.contractAddress !== reference.escrow.toLowerCase() ||
            target.ownerAddress.toLowerCase() !== verifiedHistory.ownerAddress.toLowerCase()) throw new Error('Counter reference has no exact admitted runtime.');
        return target;
      },
      privateOnly: counterCreation.privateOnly,
      publicOnly: counterCreation.publicOnly,
      recoveryOnly: counterCreation.recoveryOnly,
      balance: tradeBalances['counter-v2'],
      propose: (parent: CounterTradeV2Parent, amounts: CounterTradeV2Amounts) => {
        const privatePair = 'terms' in parent ? parent.terms.privatePair : 'bookReference' in parent
          ? counterParents.some(deployment => deployment.protocol === 'private-v2' && deployment.contractAddress.toLowerCase() === parent.bookReference.escrow.toLowerCase()) : true;
        // Child mode is checked from its authenticated stored terms before funding in the shared client.
        if (!('proposalId' in parent) || counterCreation.recoveryOnly) assertCounterTradeV2ModeAdmission(counterCreation, privatePair);
        const captured = Object.freeze({ ...amounts }), capturedParent = 'proposalId' in parent ? Object.freeze({ proposalId: parent.proposalId })
          : 'bookReference' in parent ? Object.freeze({ bookReference: Object.freeze({ ...parent.bookReference }), maker: parent.maker,
            offerToken: parent.offerToken, requestToken: parent.requestToken }) : parent;
        return exclusive(true, capability => executeCounterTradeV2Proposal({ ...counterContext(capability), parent: capturedParent, amounts: captured }));
      },
      read: (proposalId: string) => readExclusive(true, capability => readCounterTradeV2Proposal({ ...counterContext(capability), proposalId })),
      cancel: (proposalId: string) => exclusive(true, capability => cancelCounterTradeV2Proposal({ ...counterContext(capability), proposalId })),
      recipientAction: (proposal: CounterTradeV2Proposal, kind: 'accept' | 'decline') => {
        if (kind === 'accept') assertCounterTradeV2ModeAdmission(counterCreation, proposal.privatePair);
        const captured = captureWalletActionIntent(proposal);
        return exclusive(true, capability => executeCounterTradeV2RecipientAction({ ...counterContext(capability), proposal: readWalletActionIntent(captured), kind }));
      },
      syncActivity: () => readActivity(async capability => {
        const context = counterContext(capability);
        counterActivity ??= createCounterTradeV2ActivityReader({ capability: context.readCapability, deployment: context.deployment,
          parentDeployment: context.parentDeployment, parentDeployments: context.parentDeployments, ownerAddress: verifiedHistory.ownerAddress,
          pageRangeBlocks: TRADE_HISTORY_V2_MAX_PARTICIPANT_LOG_RANGE_BLOCKS });
        const current = await counterActivity.sync(capability);
        return readRetainedCounterActivity ? mergeCounterTradeV2ActivitySnapshots([current, ...await readRetainedCounterActivity()]) : current;
      }),
      cleanup: () => exclusive(true, capability => cleanupCounterTradeV2Allowance(counterContext(capability))),
      continue: (recoveryId: string) => exclusive(true, capability => continueCounterTradeV2Proposal({ ...counterContext(capability), recoveryId })),
      reconcile: (transactionHash?: string) => readExclusive(true, capability => reconcileCounterTradeV2Proposal({ ...counterContext(capability), transactionHash })),
      readRecovery: () => readExclusive(true, async capability => {
        const context = counterContext(capability), saved = await context.journal.read();
        if (!saved?.counter || saved.abandoned) return null;
        if (saved.scope.owner !== verifiedHistory.ownerAddress.toLowerCase() || saved.scope.chainId !== context.deployment.chainId ||
            saved.scope.escrow !== context.deployment.contractAddress || saved.scope.runtimeHash !== context.deployment.runtimeBytecodeHash) throw new Error('Saved counter belongs to a different deployment.');
        const last = saved.records[saved.records.length - 1];
        if (last?.step === 'cleanup' && last.state === 'confirmed') return null;
        return Object.freeze({ id: saved.id, active: saved.active, feeWei: saved.feeWei, material: saved.counter.material, kind: saved.counter.kind, last,
          canContinue: Boolean(!counterCreation.recoveryOnly && (!counterCreation.privateOnly || saved.counter.material.privatePair) &&
            (!counterCreation.publicOnly || !saved.counter.material.privatePair) && saved.active && ['create', 'accept'].includes(saved.counter.kind) && saved.records.every(r => r.state === 'confirmed' && !['create', 'accept', 'cleanup'].includes(r.step))),
          canCleanup: Boolean(!['cancel', 'decline'].includes(saved.counter.kind) && saved.records.every(r => r.state === 'confirmed' && !['create', 'accept', 'decline'].includes(r.step) || r === last && ['rejected', 'failed'].includes(r.state))) });
      })
    }) } : {}),
    ...(linkCreation ? { link: Object.freeze({
      ownerAddress: verifiedHistory.ownerAddress,
      balance: tradeBalances['link-v2'],
      readContext: Object.freeze({ capability: linkCreation.capability, deployment: linkCreation.deployment }),
      forReference: async (reference: LinkTradeV2Reference) => {
        const target = normalizeLinkTradeV2Reference(reference);
        if (!runtime.isCurrent()) throw new Error('Link runtime is closed.');
        if (target.chainId === linkCreation.deployment.chainId && target.escrow === linkCreation.deployment.contractAddress) return runtime.link!;
        if (!resolveLinkRuntime) throw new Error('Link reference has no admitted deployment.');
        const selected = await resolveLinkRuntime(target);
        if (!runtime.isCurrent() || selected.ownerAddress.toLowerCase() !== verifiedHistory.ownerAddress.toLowerCase() ||
            selected.readContext.deployment.chainId !== target.chainId || selected.readContext.deployment.contractAddress !== target.escrow)
          throw new Error('Link runtime reference changed.');
        return selected;
      },
      create: async (action: LinkTradeV2CreationAction) => {
        assertLinkFundingMode(action.terms?.privatePair);
        const intent = captureWalletActionIntent(action);
        return exclusive(true, capability => executeLinkTradeV2Creation({ readCapability: linkCreation.capability,
          deployment: linkCreation.deployment, ownerAddress: verifiedHistory.ownerAddress, capability,
          action: readWalletActionIntent(intent), ...linkCreation.journal }));
      },
      readCreation: () => readExclusive(true, async () => {
        const saved = await linkCreation.journal.read();
        const last = saved?.records[saved.records.length - 1];
        if (!saved || saved.abandoned || saved.disclosure || saved.ownerAction && last?.step === saved.ownerAction.kind && last.state === 'confirmed') return null;
        if (saved.scope.owner !== verifiedHistory.ownerAddress.toLowerCase() || saved.scope.chainId !== linkCreation.deployment.chainId ||
            saved.scope.escrow !== linkCreation.deployment.contractAddress || saved.scope.runtimeHash !== linkCreation.deployment.runtimeBytecodeHash) {
          throw new Error('Saved Link creation belongs to a different wallet or deployment.');
        }
        return Object.freeze({ id: saved.id, active: saved.active, feeWei: saved.feeWei,
          terms: saved.fill?.terms ?? saved.recovery?.terms, offerBudget: saved.recovery?.offerBudget, last,
          fill: saved.fill && Object.freeze({ reference: saved.fill.reference, maximumPayment: saved.fill.maximumPayment }),
          ownerAction: saved.ownerAction && Object.freeze({ kind: saved.ownerAction.kind, orderId: saved.ownerAction.orderId,
            offerToken: saved.ownerAction.offerToken, privatePair: saved.ownerAction.privatePair }),
          canRetry: Boolean(saved.ownerAction && last && ['rejected', 'failed'].includes(last.state)),
          canCleanup: Boolean((saved.recovery || saved.fill) && !saved.ownerAction && saved.records.every(r => r.state === 'confirmed' && !['create', 'fill'].includes(r.step) || r === last && ['rejected', 'failed'].includes(r.state))),
          canContinue: Boolean(!linkCreation.recoveryOnly && (!linkCreation.privateOnly || (saved.fill?.terms ?? saved.recovery?.terms)?.privatePair === true) &&
            saved.active && (saved.recovery || saved.fill) && !saved.ownerAction && saved.records.every(r => r.state === 'confirmed' && !['create', 'fill'].includes(r.step))) });
      }),
      reconcileCreation: (transactionHash?: string) => readExclusive(true, capability => reconcileLinkTradeV2Creation({ capability, transactionHash,
        readCapability: linkCreation.capability, deployment: linkCreation.deployment, journal: linkCreation.journal })),
      fill: async (review: LinkTradeV2Review, maximumPayment: string) => {
        assertLinkFundingMode(review.terms?.privatePair);
        // Keep the authenticated review object: cloning removes its reader-issued authority.
        return exclusive(true, capability => executeLinkTradeV2Fill({ capability, review, maximumPayment,
          readCapability: linkCreation.capability, deployment: linkCreation.deployment, journal: linkCreation.journal }));
      },
      reconcileFill: (transactionHash?: string) => readExclusive(true, capability => reconcileLinkTradeV2Fill({ capability, transactionHash,
        readCapability: linkCreation.capability, deployment: linkCreation.deployment, journal: linkCreation.journal })),
      continueFill: async (fillId: string) => {
        await assertSavedLinkFundingMode('fill');
        return exclusive(true, capability => continueLinkTradeV2Fill({ capability, fillId,
          readCapability: linkCreation.capability, deployment: linkCreation.deployment, journal: linkCreation.journal }));
      },
      syncActivity: () => readActivity(async capability => {
        linkActivity ??= createLinkTradeV2ActivityReader({ capability: linkCreation.capability, deployment: linkCreation.deployment, ownerAddress: verifiedHistory.ownerAddress,
          pageRangeBlocks: TRADE_HISTORY_V2_MAX_PARTICIPANT_LOG_RANGE_BLOCKS });
        const current = await linkActivity.sync(capability);
        return readRetainedLinkActivity ? mergeLinkTradeV2ActivitySnapshots([current, ...await readRetainedLinkActivity()]) : current;
      }),
      continueCreation: async (creationId: string) => {
        await assertSavedLinkFundingMode('create');
        return exclusive(true, capability => continueLinkTradeV2Creation({ capability, creationId,
          readCapability: linkCreation.capability, deployment: linkCreation.deployment, journal: linkCreation.journal }));
      },
      readOwnerOrder: (orderId: string) => readExclusive(true, capability => readLinkTradeV2OwnerOrder({ capability, orderId,
        readCapability: linkCreation.capability, deployment: linkCreation.deployment })),
      ownerOrderAction: (action: { orderId: string; kind: 'cancel' | 'cleanup' }) => {
        const intent = captureWalletActionIntent(action);
        return exclusive(true, capability => executeLinkTradeV2OwnerOrderAction({ capability, ...readWalletActionIntent(intent),
          readCapability: linkCreation.capability, deployment: linkCreation.deployment, journal: linkCreation.journal }));
      },
      cleanupCreation: (creationId: string) => exclusive(true, capability => cleanupLinkTradeV2Creation({ capability, creationId,
        readCapability: linkCreation.capability, deployment: linkCreation.deployment, journal: linkCreation.journal })),
      reconcileOwnerAction: (transactionHash?: string) => readExclusive(true, capability => reconcileLinkTradeV2OwnerAction({ capability, transactionHash,
        readCapability: linkCreation.capability, deployment: linkCreation.deployment, journal: linkCreation.journal })),
      retryOwnerAction: (actionId: string) => exclusive(true, capability => retryLinkTradeV2OwnerAction({ capability, actionId,
        readCapability: linkCreation.capability, deployment: linkCreation.deployment, journal: linkCreation.journal })),
      discardDraft: (creationId: string) => readExclusive(true, async () => {
        const saved = await linkCreation.journal.read();
        if (!saved?.active || saved.id !== creationId || saved.ownerAction || saved.records.length) throw new Error('A submitted Link preparation cannot be discarded.');
        if (saved.scope.owner !== verifiedHistory.ownerAddress.toLowerCase() || saved.scope.escrow !== linkCreation.deployment.contractAddress ||
            saved.scope.runtimeHash !== linkCreation.deployment.runtimeBytecodeHash) throw new Error('Saved Link creation belongs to a different wallet or deployment.');
        await linkCreation.journal.releaseUnsent();
      })
    }) } : {}),
    ...(isPrivateBookV2RuntimeHash(deployments['private-v2'].runtimeBytecodeHash) ? {
      privateBook: Object.freeze({
        ownerAddress: verifiedHistory.ownerAddress,
        budgetVisibilityAvailable: isCurrentP2PBookBudgetAdmitted(deployments['private-v2'], budgetAdmission),
        execute: (action: PrivateBookV2Action) => {
          assertCurrentP2PBookBudgetActionAdmission(deployments['private-v2'], action.kind, budgetAdmission);
          const intent = captureWalletActionIntent(action);
          return exclusive(action.kind === 'fill' || action.kind === 'budget-visibility' && action.visible || ((action.kind === 'create' || action.kind === 'replace') && action.offerAsset.assetType === 'private-erc20'), async capability => {
            const journal = getBookJournal(capability), pending = await journal.read(), last = pending?.records[pending.records.length - 1];
            if (pending?.active && (pending.cleanupOnly || !last || last.state !== 'confirmed' || last.step === pending.book.kind)) throw new Error('A Book transaction is pending. Reconcile it before another send.');
            return executePrivateBookV2Action({ capability, deployment: deployments['private-v2'], journal, action: readWalletActionIntent(intent) });
          });
        },
        readRecovery: () => readExclusive(false, capability => getBookJournal(capability).read()),
        readPreparedAction: () => readExclusive(false, async capability => {
          let journal = getBookJournal(capability);
          const saved = await journal.read();
          if (!saved?.active || saved.cleanupOnly || !saved.records.length || saved.records.some(record => record.state !== 'confirmed' || record.step === saved.book.kind)) throw new Error('The saved Book call needs reconciliation first.');
          const current = saved.book.kind === 'fill' || saved.book.approvalPrivate ? await getOwnerCapability(true) : capability;
          journal = getBookJournal(current);
          const funding = await readPrivateBookV2PreparedAction({ capability: current, deployment: deployments['private-v2'], journal });
          if ((await journal.read())?.id !== saved.id) throw new Error('The saved Book preparation changed.');
          return funding;
        }),
        discardPreparation: (id: string) => readExclusive(false, async capability => {
          const journal = getBookJournal(capability), saved = await journal.read();
          if (!saved?.active || saved.id !== id || saved.records.length) throw new Error('A signed Book request cannot be discarded.');
          await journal.releaseUnsent();
        }),
        cleanupPreparation: (preparationId: string) => exclusive(false, async capability => {
          const saved = await getBookJournal(capability).read();
          if (!saved?.active || saved.id !== preparationId || !saved.book.approvalToken) throw new Error('The saved Book preparation is unavailable.');
          const current = saved.book.approvalPrivate ? await getOwnerCapability(true) : capability;
          if (!alive || !verifiedHistory.isCurrent()) throw new Error('OTC V2 action runtime closed before cleanup.');
          return cleanupPrivateBookV2Preparation({ capability: current, deployment: deployments['private-v2'], journal: getBookJournal(current), preparationId });
        }),
        reconcile: (transactionHash?: string) => readExclusive(false, async capability => {
          const saved = await getBookJournal(capability).read(), last = saved?.records[saved.records.length - 1];
          const current = last?.step === 'cleanup' && saved?.book.approvalPrivate ? await getOwnerCapability(true) : capability;
          if (!alive || !verifiedHistory.isCurrent()) throw new Error('OTC V2 action runtime closed during reconciliation.');
          return reconcilePrivateBookV2Action({ capability: current, deployment: deployments['private-v2'], journal: getBookJournal(current), transactionHash });
        }),
        list: (scope: 'maker' | 'filler' | 'open', offset = 0n, limit = 50n) => readExclusive(false, capability => readPrivateBookV2OrderIds({ capability, deployment: deployments['private-v2'], scope, offset, limit })),
        read: (orderId: bigint | number | string) => readExclusive(false, capability => readPrivateBookV2OrderView({ capability, deployment: deployments['private-v2'], orderId })),
        readAccount: (orderId: bigint | number | string) => readExclusive(true, capability => readPrivateBookV2AccountSnapshot({ capability, deployment: deployments['private-v2'], orderId }))
      })
    } : {}),
    direct: async (action: DirectTradeV2Action) => {
      const intent = captureWalletActionIntent(action);
      const boundAction = readWalletActionIntent(intent);
      assertCurrentP2PDirectActionAdmission(deployments['direct-v2'], boundAction.kind, directAdmission);
      return exclusive(
        boundAction.kind.includes('private'),
        async (capability) => {
          const deployment = deployments['direct-v2'];
          await ensureDirectTradeV2ActionAllowance({ capability, deployment, action: boundAction, actionAdmission: directAdmission });
          if (!alive || !verifiedHistory.isCurrent()) throw new Error('OTC V2 action runtime closed before submission.');
          return confirmDirectTradeV2Action(await submitDirectTradeV2Action({
            capability,
            deployment,
            action: boundAction,
            actionAdmission: directAdmission
          }));
        }
      );
    },
    privateRecurring: (action: PrivateRecurringTradeV2Action) => {
      const intent = captureWalletActionIntent(action);
      return exclusive(
        true,
        async (capability) => confirmPrivateRecurringTradeV2Action(await submitPrivateRecurringTradeV2Action({
          capability,
          deployment: deployments['private-recurring-v2'],
          action: readWalletActionIntent(intent)
        }))
      );
    },
    privateTrade: (action: PrivateTradeV2Action) => {
      assertLegacyPrivateApi();
      const intent = captureWalletActionIntent(action);
      return exclusive(
        true,
        (capability) => executePrivateTradeV2Action({
          capability,
          deployment: deployments['private-v2'],
          action: readWalletActionIntent(intent)
        })
      );
    },
    recurring: (action: RecurringTradeV2Action) => {
      const intent = captureWalletActionIntent(action);
      return exclusive(
        false,
        async (capability) => confirmRecurringTradeV2Action(await submitRecurringTradeV2Action({
          capability,
          deployment: deployments['recurring-v2'],
          action: readWalletActionIntent(intent)
        }))
      );
    },
    standard: (action: StandardTradeV2Action) => {
      if (!['cancel', 'reclaim-expired', 'withdraw-native-credit'].includes(action.kind)) {
        if (standardAdmission === 'recovery') throw new Error('Public Book trading is waiting for App activation.');
        if (standardAdmission === 'forward' && action.kind === 'replace') throw new Error('Public Book replacement is not ready on the Testnet candidate.');
      }
      const intent = captureWalletActionIntent(action);
      const boundAction = readWalletActionIntent(intent);
      return exclusive(
        false,
        async (capability) => {
          const deployment = deployments['standard-v2'];
          await ensureStandardTradeV2Allowance({ capability, deployment, action: boundAction });
          return confirmStandardTradeV2Action(await submitStandardTradeV2Action({
            capability,
            deployment,
            action: boundAction
          }));
        }
      );
    },
    listStandard: (scope: 'recent' | 'maker' | 'filler' | 'open', offset = 0n, limit = 50n) => readExclusive(
      false,
      (capability) => readStandardTradeV2Ids({
        capability,
        deployment: deployments['standard-v2'],
        scope,
        offset,
        limit
      })
    ),
    readStandard: (tradeId: bigint | number | string) => readExclusive(
      false,
      (capability) => readStandardTradeV2View({
        capability,
        deployment: deployments['standard-v2'],
        tradeId
      })
    ),
    quoteStandard: (tradeId: bigint | number | string, requestAmountIn: bigint | number | string) => readExclusive(
      false,
      (capability) => quoteStandardTradeV2Fill({
        capability,
        deployment: deployments['standard-v2'],
        tradeId,
        requestAmountIn
      })
    ),
    listPrivateTrade: (scope: 'maker' | 'filler' | 'open', offset = 0n, limit = 50n) => readExclusive(
      false,
      (capability) => readPrivateTradeV2OrderIds({
        capability,
        deployment: deployments['private-v2'],
        scope,
        offset,
        limit
      })
    ),
    readPrivateTrade: (orderId: bigint | number | string) => {
      assertLegacyPrivateApi();
      return readExclusive(
        false,
        (capability) => readPrivateTradeV2OrderView({
          capability,
          deployment: deployments['private-v2'],
          orderId
        })
      );
    },
    readPrivateTradeAccount: (orderId: bigint | number | string) => {
      assertLegacyPrivateApi();
      return readExclusive(
        true,
        (capability) => readPrivateTradeV2AccountSnapshot({
          capability,
          deployment: deployments['private-v2'],
          orderId
        })
      );
    },
    listDirect: (
      scope: 'maker' | 'taker' | 'counter',
      offset = 0n,
      limit = 50n,
      parentTradeId?: bigint | number | string
    ) => readExclusive(
      false,
      (capability) => readDirectTradeV2TradeIds({
        capability,
        deployment: deployments['direct-v2'],
        scope,
        parentTradeId,
        offset,
        limit
      })
    ),
    readDirect: (tradeId: bigint | number | string, decryptPrivateAmounts = false) => readExclusive(
      decryptPrivateAmounts,
      (capability) => deploymentOverride?.protocol === 'direct-v2'
        ? readDirectTradeV2TradeTerms({ capability, readCapability: verifiedHistory.readCapability, deployment: deployments['direct-v2'], tradeId, decryptPrivateAmounts })
        : verifiedHistory.readDirectTerms(capability, tradeId, decryptPrivateAmounts)
    ),
    listRecurring: (scope: 'recent' | 'maker' | 'filler' | 'active', offset = 0n, limit = 50n) => readExclusive(
      false,
      (capability) => readRecurringTradeV2OrderIds({
        capability,
        deployment: deployments['recurring-v2'],
        scope,
        offset,
        limit
      })
    ),
    readRecurring: (orderId: bigint | number | string) => readExclusive(
      false,
      (capability) => readRecurringTradeV2OrderView({
        capability,
        deployment: deployments['recurring-v2'],
        orderId
      })
    ),
    quoteRecurring: (
      orderId: bigint | number | string,
      side: 'buy' | 'sell',
      maxInputAmount: bigint | number | string
    ) => readExclusive(
      false,
      (capability) => quoteRecurringTradeV2Execution({
        capability,
        deployment: deployments['recurring-v2'],
        orderId,
        side,
        maxInputAmount
      })
    ),
    listPrivateRecurring: (scope: 'maker' | 'filler' | 'active', offset = 0n, limit = 50n) => readExclusive(
      false,
      (capability) => readPrivateRecurringTradeV2OrderIds({
        capability,
        deployment: deployments['private-recurring-v2'],
        scope,
        offset,
        limit
      })
    ),
    readPrivateRecurring: (orderId: bigint | number | string) => readExclusive(
      false,
      (capability) => readPrivateRecurringTradeV2OrderView({
        capability,
        deployment: deployments['private-recurring-v2'],
        orderId
      })
    ),
    readPrivateRecurringInventory: (orderId: bigint | number | string) => readExclusive(
      true,
      (capability) => readPrivateRecurringTradeV2MakerInventory({
        capability,
        deployment: deployments['private-recurring-v2'],
        orderId
      })
    ),
    readPrivateRecurringReceipt: (orderId: bigint | number | string) => readExclusive(
      true,
      (capability) => readPrivateRecurringTradeV2ExecutionReceipt({
        capability,
        deployment: deployments['private-recurring-v2'],
        orderId
      })
    ),
    ...(resolveLinkReadContext ? { resolveLinkReadContext: async (reference: LinkTradeV2Reference) => {
      if (!alive || !verifiedHistory.isCurrent()) throw new Error('Link review runtime is closed.');
      const target = normalizeLinkTradeV2Reference(reference);
      const context = await resolveLinkReadContext(target);
      if (!alive || !verifiedHistory.isCurrent()) throw new Error('Link review runtime closed during selection.');
      assertAttestedTradeHistoryV2Deployment(context.deployment, 'link-v2');
      if (context.deployment.chainId !== target.chainId || context.deployment.contractAddress !== target.escrow)
        throw new Error('Link review reference and deployment differ.');
      return context;
    } } : {}),
    deployments,
    ...(!deploymentOverride && verifiedHistory.retainedDeployments ? { retainedDeployments: verifiedHistory.retainedDeployments } : {}),
    forReference: async (reference: TradeHistoryV2OrderRef) => {
      if (!alive || !verifiedHistory.isCurrent()) throw new Error('OTC reference runtime is closed.');
      const target = Object.freeze({ ...reference, contractAddress: reference.contractAddress.toLowerCase() });
      if (!/^[1-9][0-9]*$/.test(target.orderId) || BigInt(target.orderId) >= (1n << 256n) || !/^0x[0-9a-f]{40}$/.test(target.contractAddress)) throw new Error('Invalid OTC reference.');
      if (Object.values(deployments).some(deployment => deployment.chainId === target.chainId && deployment.contractAddress === target.contractAddress)) return runtime;
      if (linkCreation?.deployment.chainId === target.chainId && linkCreation.deployment.contractAddress === target.contractAddress) return runtime;
      if (counterCreation?.deployment.chainId === target.chainId && counterCreation.deployment.contractAddress === target.contractAddress) return runtime;
      if (!resolveReference) throw new Error('OTC reference has no admitted deployment.');
      const selected = await resolveReference(target);
      if (!alive || !verifiedHistory.isCurrent() || !selected.isCurrent()) throw new Error('OTC reference runtime closed during selection.');
      return selected;
    },
    isCurrent: () => alive && verifiedHistory.isCurrent(),
    close: () => {
      if (!alive) return;
      alive = false; linkActivity?.close(); counterActivity?.close();
      linkCreation?.journal.close?.(); counterCreation?.journal.close();
      bookJournal?.close();
      for (const journal of disclosureJournals) journal.close?.();
      onClose?.();
    }
  }) as unknown as OtcV2ActionRuntime;
  ACTION_RUNTIMES.add(runtime);
  return runtime;
};

/** App root entry. Supplied journals live for this runtime; encrypted records survive close. */
export const createOtcV2ActionRuntimeFromCatalog = async (input: Pick<Parameters<typeof createOtcV2ActionRuntime>[0], 'history' | 'getOwnerCapability' | 'runOwnerTransactionFlow'> & {
  catalog: OtcV2DeploymentCatalog;
}): Promise<OtcV2ActionRuntime> => {
  const history = assertOtcTradeHistoryV2Runtime(input.history);
  if (!history.isCurrent()) throw new Error('OTC root history is closed.');
  const catalog = input.catalog;
  if (catalog.status !== 'active') throw new Error('OTC root catalog is unavailable.');
  const graph = catalog.preparedP2p;
  if (!graph || graph.status === 'prepared') return createOtcV2ActionRuntime(input);
  if (graph.status !== 'admitted' && graph.status !== 'book-admitted') throw new Error('P2P graph admission is unavailable.');
  const directAdmission: CurrentP2PDirectAdmission = graph.directAdmission ?? Object.freeze({ ...graph.deployments['direct-v2'].manifest,
    mode: graph.status === 'admitted' ? 'full' : 'held' });
  const standardAdmission = graph.status === 'admitted' ? 'full' : graph.publicBookLinkAdmitted ? 'forward' : 'recovery';
  const selected: Array<'standard-v2' | 'private-v2' | 'direct-v2'> = ['private-v2'];
  if (graph.status === 'admitted' || graph.publicBookLinkRecoveryAdmitted) selected.push('standard-v2');
  if (graph.status === 'admitted' || ['private-forward', 'public-forward'].includes(directAdmission.mode)) selected.push('direct-v2');
  for (const protocol of selected) {
    const actual = history.deployments[protocol], expected = graph.deployments[protocol].manifest;
    if (actual.chainId !== expected.chainId || actual.contractAddress !== expected.contractAddress ||
        actual.runtimeBytecodeHash !== expected.runtimeBytecodeHash || actual.deploymentBlock !== expected.deploymentBlock) throw new Error('OTC root does not match the admitted P2P graph.');
  }
  const journals: ReturnType<typeof createLinkTradeV2CreationJournal>[] = [];
  try {
    let linked: Pick<Parameters<typeof createOtcV2ActionRuntime>[0], 'linkCreation' | 'counterCreation'> = {};
    if (graph.status === 'admitted' || graph.linkAdmitted) {
      const capability = await input.getOwnerCapability(false);
      const owner = getOwnerTradeV2CapabilityBinding(capability);
      if (owner.ownerAddress.toLowerCase() !== history.ownerAddress.toLowerCase() || owner.chainId.toString() !== catalog.chainId) throw new Error('OTC root owner or chain changed.');
      const admitted = await attestTradeHistoryV2Deployments({ capability: history.readCapability,
        manifests: [graph.deployments['link-v2'].manifest,
          ...(graph.status === 'admitted' || graph.privateCounterRecoveryAdmitted || graph.publicBookLinkRecoveryAdmitted
            ? [graph.deployments['counter-v2'].manifest] : [])], finalityLagBlocks: catalog.finalityLagBlocks });
      if (!history.isCurrent()) throw new Error('OTC root history closed during setup.');
      const link = admitted.find((deployment): deployment is LinkTradeV2Deployment => deployment.protocol === 'link-v2');
      const counter = admitted.find((deployment): deployment is CounterTradeV2Deployment => deployment.protocol === 'counter-v2');
      if (!link) throw new Error('OTC root Link admission is missing.');
      const linkJournal = createLinkTradeV2CreationJournal({ capability, deployment: link }); journals.push(linkJournal);
      linked = { linkCreation: { capability: history.readCapability, deployment: link, journal: linkJournal,
        privateOnly: graph.status !== 'admitted' && !graph.publicBookLinkAdmitted } };
      if (counter) {
        const counterJournal = createLinkTradeV2CreationJournal({ capability, deployment: counter }); journals.push(counterJournal);
        linked.counterCreation = { deployment: counter, journal: counterJournal,
          privateOnly: graph.status !== 'admitted' && !graph.publicBookLinkAdmitted,
          publicOnly: graph.status !== 'admitted' && !graph.privateCounterAdmitted,
          recoveryOnly: graph.status !== 'admitted' && !graph.privateCounterAdmitted && !graph.publicBookLinkAdmitted };
      }
    }
    const retained = new Map<string, Promise<OtcV2ActionRuntime>>(), children = new Set<OtcV2ActionRuntime>();
    const linkReadContexts = new Map<string, ReturnType<NonNullable<OtcV2ActionRuntime['resolveLinkReadContext']>>>();
    const retainedLinkDescriptors = Object.values(graph.retainedDeployments).filter((item): item is OtcV2Deployment<'link-v2'> =>
      item.protocol === 'link-v2' && item.manifest.protocol === 'link-v2');
    const retainedCounterDescriptors = [...new Map(Object.values(graph.retainedDeployments)
      .filter((item): item is OtcV2Deployment<'counter-v2'> => item.protocol === 'counter-v2' && item.manifest.protocol === 'counter-v2')
      .map(item => [`${item.manifest.chainId}:${item.manifest.contractAddress.toLowerCase()}`, item])).values()];
    const loadRetained = (descriptor: typeof graph.retainedDeployments[string]): Promise<OtcV2ActionRuntime> => {
      const reference = descriptor.manifest, financialGraph = descriptor.retainedFinancialGraph;
      const key = financialGraph ? `financial:${financialGraph.proofSha256}:${financialGraph.previousBindingSha256}` : `${reference.chainId}:${reference.contractAddress}`;
      if (!retained.has(key)) retained.set(key, (async () => {
        if (descriptor.manifest.protocol !== descriptor.protocol) throw new Error('Retained deployment protocol differs.');
        if (financialGraph) {
          const old = await attestTradeHistoryV2Deployments({ capability: history.readCapability,
            manifests: financialGraph.deployments, finalityLagBlocks: catalog.finalityLagBlocks });
          if (!runtime.isCurrent()) throw new Error('OTC root closed during retained financial selection.');
          const capability = await input.getOwnerCapability(false), owner = getOwnerTradeV2CapabilityBinding(capability);
          if (!runtime.isCurrent() || owner.ownerAddress.toLowerCase() !== history.ownerAddress.toLowerCase() || owner.chainId.toString() !== catalog.chainId)
            throw new Error('Retained financial owner or chain changed.');
          const link = old.find((deployment): deployment is LinkTradeV2Deployment => deployment.protocol === 'link-v2');
          const counter = old.find((deployment): deployment is CounterTradeV2Deployment => deployment.protocol === 'counter-v2');
          const direct = old.find(deployment => deployment.protocol === 'direct-v2');
          if (!link || !counter || !direct) throw new Error('Retained financial graph is incomplete.');
          const linkJournal = createLinkTradeV2CreationJournal({ capability, deployment: link });
          const counterJournal = createLinkTradeV2CreationJournal({ capability, deployment: counter });
          const child = createOtcV2ActionRuntime({ ...input, deploymentOverrides: old.filter((deployment): deployment is AttestedTradeHistoryV2Deployment<'standard-v2' | 'private-v2' | 'direct-v2'> =>
            deployment.protocol === 'standard-v2' || deployment.protocol === 'private-v2' || deployment.protocol === 'direct-v2'),
            directAdmission: Object.freeze({ ...directAdmission, ...direct }), bookBudgetAdmission: undefined, tradeBalanceAdmissions: {}, standardAdmission,
            linkCreation: { capability: history.readCapability, deployment: link, journal: linkJournal,
              privateOnly: graph.status !== 'admitted' && !graph.publicBookLinkAdmitted },
            counterCreation: { deployment: counter, journal: counterJournal, privateOnly: graph.status !== 'admitted' && !graph.publicBookLinkAdmitted,
              publicOnly: graph.status !== 'admitted' && !graph.privateCounterAdmitted,
              recoveryOnly: graph.status !== 'admitted' && !graph.privateCounterAdmitted && !graph.publicBookLinkAdmitted } });
          children.add(child); return child;
        }
        if (descriptor.protocol === 'link-v2') {
          const deployment = await attestTradeHistoryV2Deployment({ capability: history.readCapability,
            manifest: { ...descriptor.manifest, protocol: descriptor.protocol }, finalityLagBlocks: catalog.finalityLagBlocks });
          if (!runtime.isCurrent()) throw new Error('OTC root closed during retained Link selection.');
          const capability = await input.getOwnerCapability(false), owner = getOwnerTradeV2CapabilityBinding(capability);
          if (!runtime.isCurrent()) throw new Error('OTC root closed during retained Link selection.');
          if (owner.ownerAddress.toLowerCase() !== history.ownerAddress.toLowerCase() || owner.chainId.toString() !== catalog.chainId)
            throw new Error('Retained Link owner or chain changed.');
          const journal = createLinkTradeV2CreationJournal({ capability, deployment });
          const child = createOtcV2ActionRuntime({ ...input, directAdmission, bookBudgetAdmission: undefined, standardAdmission: 'recovery', linkCreation: { capability: history.readCapability, deployment, journal, recoveryOnly: true } });
          children.add(child); return child;
        }
        if (descriptor.protocol === 'counter-v2') throw new Error('Retained Counter requires its parent admission.');
        const existing = history.retainedDeployments?.find(item => item.chainId === reference.chainId && item.contractAddress === reference.contractAddress);
        if (existing && (existing.protocol !== descriptor.protocol || existing.runtimeBytecodeHash !== descriptor.manifest.runtimeBytecodeHash ||
            existing.deploymentBlock !== descriptor.manifest.deploymentBlock)) throw new Error('Retained history and catalog identities differ.');
        const deployment = existing ?? await attestTradeHistoryV2Deployment({ capability: history.readCapability,
          manifest: { ...descriptor.manifest, protocol: descriptor.protocol }, finalityLagBlocks: catalog.finalityLagBlocks });
        if (!runtime.isCurrent()) throw new Error('OTC root closed during retained reference selection.');
        const child = createOtcV2ActionRuntime({ ...input, directAdmission, bookBudgetAdmission: undefined, standardAdmission: 'recovery', deploymentOverride: deployment }); children.add(child); return child;
      })());
      return retained.get(key)!;
    };
    const runtime = createOtcV2ActionRuntime({ ...input, ...linked, directAdmission, bookBudgetAdmission: graph.bookBudgetAdmission,
      tradeBalanceAdmissions: graph.tradeBalanceAdmissions, standardAdmission,
      resolveLinkReadContext: async reference => {
        const manifest = [graph.deployments['link-v2'].manifest, ...retainedLinkDescriptors.map(item => item.manifest)]
          .find(item => item.chainId === reference.chainId && item.contractAddress.toLowerCase() === reference.escrow);
        if (!manifest) throw new Error('Link reference has no selected deployment.');
        if (runtime.link?.readContext.deployment.contractAddress === manifest.contractAddress) return runtime.link.readContext;
        const key = `${manifest.chainId}:${manifest.contractAddress}`;
        if (!linkReadContexts.has(key)) linkReadContexts.set(key, attestTradeHistoryV2Deployment({ capability: history.readCapability, manifest, finalityLagBlocks: catalog.finalityLagBlocks })
          .then(deployment => Object.freeze({ capability: history.readCapability, deployment }))
          .catch(error => { linkReadContexts.delete(key); throw error; }));
        return linkReadContexts.get(key)!;
      },
      resolveLinkRuntime: async reference => {
        const selected = await runtime.forReference!({ chainId: reference.chainId, contractAddress: reference.escrow, orderId: reference.id });
        if (!selected.link) throw new Error('Retained Link runtime is unavailable.');
        return selected.link;
      },
      readRetainedLinkActivity: retainedLinkDescriptors.length ? async () => {
        const snapshots: LinkTradeV2ActivitySnapshot[] = [];
        for (const descriptor of retainedLinkDescriptors) {
          const child = await loadRetained(descriptor);
          if (!child.link) throw new Error('Retained Link activity is unavailable.');
          snapshots.push(await child.link.syncActivity());
        }
        return snapshots;
      } : undefined,
      readRetainedCounterActivity: retainedCounterDescriptors.length ? async () => {
        const snapshots: CounterTradeV2ActivitySnapshot[] = [];
        for (const descriptor of retainedCounterDescriptors) {
          const child = await loadRetained(descriptor);
          if (!child.counter || child.counter.readContext.deployment.chainId !== descriptor.manifest.chainId ||
              child.counter.readContext.deployment.contractAddress !== descriptor.manifest.contractAddress) throw new Error('Retained Counter activity is unavailable.');
          snapshots.push(await child.counter.syncActivity());
        }
        return snapshots;
      } : undefined,
      resolveReference: reference => {
        const descriptor = Object.values(graph.retainedDeployments).find(item => item.manifest.chainId === reference.chainId && item.manifest.contractAddress.toLowerCase() === reference.contractAddress);
        if (!descriptor) throw new Error('OTC reference has no retained deployment.');
        return loadRetained(descriptor);
      },
      onClose: () => { children.forEach(child => child.close()); children.clear(); retained.clear(); linkReadContexts.clear(); }
    });
    return runtime;
  } catch (error) { journals.forEach(journal => journal.close()); throw error; }
};

export const assertOtcV2ActionRuntime = (runtime: OtcV2ActionRuntime): OtcV2ActionRuntime => {
  if (!runtime || !ACTION_RUNTIMES.has(runtime)) {
    throw new Error('OTC V2 actions require a runtime created from the verified suite.');
  }
  return runtime;
};
