import { getAddress, type Eip1193Provider } from '@coti-io/coti-ethers';
import type { ChatMessage } from './appShared/core';
import {
  confirmDirectTradeV2Action,
  ensureDirectTradeV2ActionAllowance,
  readDirectTradeV2PublicTradeTerms,
  readDirectTradeV2TradeTerms,
  submitDirectTradeV2Action,
  type ConfirmedDirectTradeV2Action,
  type DirectTradeV2Action,
  type DirectTradeV2MetaMaskCapability,
  type DirectTradeV2TradeTerms
} from './directTradeV2Actions';
import type { DirectTradeV2ChatEntry } from './directTradeV2ChatProjection';
import type { DirectTradeV2DeploymentConfig } from './directTradeV2Deployment';
import {
  attestTradeHistoryV2Deployment,
  bindTradeHistoryV2ReadCapability,
  readTradeHistoryV2CanonicalBlock,
  readTradeHistoryV2LatestBlockNumber,
  type AttestedTradeHistoryV2Deployment
} from './tradeHistoryV2Chain';
import {
  createTradeHistoryV2LedgerState,
  getTradeHistoryV2LedgerRevision
} from './tradeHistoryV2Ledger';
import {
  createTradeHistoryV2MaterializationState,
  getTradeHistoryV2MaterializationRevision,
  listTradeHistoryV2DirectChatEntries,
  listTradeHistoryV2LifecycleEvents
} from './tradeHistoryV2Materialize';
import {
  syncTradeHistoryV2PipelineRange,
  type TradeHistoryV2PipelineState
} from './tradeHistoryV2Pipeline';
import { createTradeHistoryV2SyncState } from './tradeHistoryV2Sync';
import type { TradeHistoryV2OrderRef } from './tradeHistoryV2Ledger';
import { captureWalletActionIntent, readWalletActionIntent } from './walletActionIntent';
import { assertCurrentP2PDirectActionAdmission } from './currentP2PBinding';

type ActiveDirectTradeV2Config = Extract<DirectTradeV2DeploymentConfig, { status: 'active' }>;
type ReadProvider = Pick<Eip1193Provider, 'request'>;
type MessagesByContact = Record<string, ChatMessage[]>;

export type DirectTradeV2OwnerCapabilityGetter = (
  requirePrivacy: boolean
) => Promise<DirectTradeV2MetaMaskCapability>;

export type DirectTradeV2RuntimeSyncBatch = Readonly<{
  applied: boolean;
  contacts: readonly string[];
  canonicalIncomingOpenings: readonly DirectTradeV2ChatEntry[];
  newIncomingOpenings: readonly DirectTradeV2ChatEntry[];
  incomingContacts: readonly string[];
  /** Older current-contract history can remain outside the notification window. */
  historyComplete: boolean;
  hasMore: boolean;
  reorged: boolean;
  safeHead: string;
  apply(previous: MessagesByContact): MessagesByContact;
}>;

declare const DIRECT_TRADE_V2_RUNTIME_BRAND: unique symbol;
export type DirectTradeV2Runtime = Readonly<{
  readonly [DIRECT_TRADE_V2_RUNTIME_BRAND]: true;
  contractAddress: string;
  deployment: AttestedTradeHistoryV2Deployment;
  ownerAddress: string;
  supportedContracts?: readonly string[];
  sync(): Promise<DirectTradeV2RuntimeSyncBatch>;
  readTradeTerms(
    tradeId: bigint | number | string,
    options?: Readonly<{ decryptPrivateAmounts?: boolean }>
  ): Promise<DirectTradeV2TradeTerms>;
  execute(action: DirectTradeV2Action): Promise<ConfirmedDirectTradeV2Action>;
  isCurrent(): boolean;
  close(): void;
}>;

const RUNTIMES = new WeakSet<object>();

const messageOrder = (left: ChatMessage, right: ChatMessage): number => {
  const blockDelta = (left.blockNumber ?? 0) - (right.blockNumber ?? 0);
  if (blockDelta !== 0) return blockDelta;
  const logDelta = (left.logIndex ?? 0) - (right.logIndex ?? 0);
  if (logDelta !== 0) return logDelta;
  const timeDelta = (left.timestamp ?? 0) - (right.timestamp ?? 0);
  if (timeDelta !== 0) return timeDelta;
  return left.id.localeCompare(right.id);
};

/** Replaces only one canonical Direct Trade V2 projection, preserving chat and legacy trade rows. */
export const reconcileDirectTradeV2ChatMessages = ({
  previous,
  entries,
  chainId,
  contractAddress,
  viewerAddress
}: {
  previous: MessagesByContact;
  entries: readonly DirectTradeV2ChatEntry[];
  chainId: string;
  contractAddress: string;
  viewerAddress: string;
}): MessagesByContact => {
  const normalizedContract = getAddress(contractAddress).toLowerCase();
  const normalizedViewer = getAddress(viewerAddress).toLowerCase();
  const next: MessagesByContact = {};
  for (const [contact, messages] of Object.entries(previous)) {
    const retained = messages.filter((message) => {
      const identity = message.directTradeV2;
      return !identity || identity.chainId !== chainId || identity.contractAddress !== normalizedContract;
    });
    if (retained.length > 0) next[contact] = retained;
  }
  for (const entry of entries) {
    const identity = entry.message.directTradeV2;
    const contact = getAddress(entry.contact).toLowerCase();
    if (
      entry.viewer !== normalizedViewer ||
      !identity ||
      identity.chainId !== chainId ||
      identity.contractAddress !== normalizedContract ||
      contact === normalizedViewer
    ) {
      throw new Error('Direct Trade V2 chat projection belongs to another runtime scope.');
    }
    const messages = next[contact] ?? [];
    if (!messages.some((message) => message.id === entry.message.id)) {
      next[contact] = [...messages, entry.message];
    }
  }
  for (const [contact, messages] of Object.entries(next)) {
    next[contact] = [...messages].sort(messageOrder);
  }
  return next;
};

const actionNeedsPrivacy = (action: DirectTradeV2Action): boolean =>
  action.kind === 'create-private' ||
  action.kind === 'counter-private' ||
  action.kind === 'replace-private' ||
  action.kind === 'accept-private';

/**
 * Selects only newly discovered trade openings addressed to the viewer.
 * Status transitions remain in history but must never produce an alert.
 */
export const listCanonicalIncomingDirectTradeV2Openings = ({
  entries,
  replacementTradeIds
}: {
  entries: readonly DirectTradeV2ChatEntry[];
  replacementTradeIds: ReadonlySet<string>;
}): readonly DirectTradeV2ChatEntry[] => Object.freeze(entries.filter((entry) =>
  entry.message.direction === 'incoming' &&
  entry.message.directTradeV2?.eventKind === 'opened' &&
  !replacementTradeIds.has(entry.message.directTradeV2.tradeId)
));

export const listNewIncomingDirectTradeV2Openings = ({
  entries,
  previousIds,
  replacementTradeIds,
  enabled
}: {
  entries: readonly DirectTradeV2ChatEntry[];
  previousIds: ReadonlySet<string>;
  replacementTradeIds: ReadonlySet<string>;
  enabled: boolean;
}): readonly DirectTradeV2ChatEntry[] => enabled
  ? Object.freeze(listCanonicalIncomingDirectTradeV2Openings({ entries, replacementTradeIds })
      .filter((entry) => !previousIds.has(entry.message.id)))
  : Object.freeze([]);

export const createDirectTradeV2Runtime = async ({
  config,
  ownerAddress,
  provider,
  assertCurrent,
  getOwnerCapability,
  runOwnerTransactionFlow,
  maxBlockSpan = 512n,
  overlapBlocks = 16n
}: {
  config: ActiveDirectTradeV2Config;
  ownerAddress: string;
  provider: ReadProvider;
  assertCurrent: () => void | Promise<void>;
  getOwnerCapability: DirectTradeV2OwnerCapabilityGetter;
  runOwnerTransactionFlow: <T>(operation: () => Promise<T>) => Promise<T>;
  maxBlockSpan?: bigint;
  overlapBlocks?: bigint;
}): Promise<DirectTradeV2Runtime> => {
  if (!config || config.status !== 'active' || typeof getOwnerCapability !== 'function' ||
      typeof runOwnerTransactionFlow !== 'function') {
    throw new Error('Direct Trade V2 runtime requires an active deployment configuration.');
  }
  const owner = getAddress(ownerAddress).toLowerCase();
  const readCapability = await bindTradeHistoryV2ReadCapability({
    provider,
    expectedChainId: BigInt(config.manifest.chainId),
    assertCurrent
  });
  const deployment = await attestTradeHistoryV2Deployment({
    capability: readCapability,
    manifest: config.manifest,
    finalityLagBlocks: config.finalityLagBlocks
  });
  const record = {
    deployment,
    scope: Object.freeze({
      chainId: deployment.chainId,
      contractAddress: deployment.contractAddress,
      deploymentBlock: deployment.deploymentBlock
    }),
    caughtUp: false,
    state: Object.freeze({
      sync: createTradeHistoryV2SyncState(createTradeHistoryV2LedgerState()),
      materialization: createTradeHistoryV2MaterializationState()
    }) as TradeHistoryV2PipelineState
  };
  let alive = true;
  let operationTail = Promise.resolve();

  const exclusive = async <T>(operation: () => Promise<T>): Promise<T> => {
    const previous = operationTail;
    let release = () => {};
    operationTail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      if (!alive) throw new Error('Direct Trade V2 runtime is closed.');
      await assertCurrent();
      const result = await operation();
      await assertCurrent();
      if (!alive) throw new Error('Direct Trade V2 runtime closed during an operation.');
      return result;
    } finally {
      release();
    }
  };

  const syncScope = async () => {
    const { deployment, scope, state, caughtUp } = record;
    const previousEntries = listTradeHistoryV2DirectChatEntries({
      state: state.materialization,
      chainId: scope.chainId,
      contractAddress: scope.contractAddress,
      viewer: owner
    });
    const previousIds = new Set(previousEntries.map((entry) => entry.message.id));
    const wasCaughtUp = caughtUp;
    const result = await syncTradeHistoryV2PipelineRange({
      previous: state,
      scope,
      capability: readCapability,
      deployment,
      confirmationDepth: config.finalityLagBlocks,
      maxBlockSpan,
      overlapBlocks,
      mode: 'latest',
      reads: {
        getLatestBlockNumber: () => readTradeHistoryV2LatestBlockNumber(readCapability),
        readCanonicalBlock: async (_chainId, blockNumber) => readTradeHistoryV2CanonicalBlock({
          capability: readCapability,
          blockNumber: BigInt(blockNumber)
        })
      },
      viewer: owner,
      expectedLedgerRevision: getTradeHistoryV2LedgerRevision({
        state: state.sync.ledger,
        chainId: scope.chainId,
        contractAddress: scope.contractAddress
      }),
      expectedMaterializationRevision: getTradeHistoryV2MaterializationRevision({
        state: state.materialization,
        chainId: scope.chainId,
        contractAddress: scope.contractAddress
      }),
      shouldContinue: () => alive
    });
    const entries = listTradeHistoryV2DirectChatEntries({
      state: result.state.materialization,
      chainId: scope.chainId,
      contractAddress: scope.contractAddress,
      viewer: owner
    });
    const contacts = Object.freeze([...new Set(entries.map((entry) => entry.contact))]);
    const replacementTradeIds = new Set(listTradeHistoryV2LifecycleEvents({
      state: result.state.materialization,
      chainId: scope.chainId,
      contractAddress: scope.contractAddress
    }).flatMap((event) =>
      event.kind === 'lifecycle' &&
      event.lifecycleKind === 'replacement' &&
      event.replacementOrderId
        ? [event.replacementOrderId]
        : []
    ));
    const canonicalIncomingOpenings = listCanonicalIncomingDirectTradeV2Openings({
      entries,
      replacementTradeIds
    });
    const newIncomingOpenings = listNewIncomingDirectTradeV2Openings({
      entries,
      previousIds,
      replacementTradeIds,
      enabled: wasCaughtUp && !result.reorged && !result.reset
    });
    const incomingContacts = Object.freeze([
      ...new Set(newIncomingOpenings.map((entry) => entry.contact))
    ]);
    const batch: DirectTradeV2RuntimeSyncBatch = Object.freeze({
      applied: result.status !== 'up-to-date' || result.reorged,
      contacts,
      canonicalIncomingOpenings,
      newIncomingOpenings,
      incomingContacts,
      historyComplete: !result.hasMore,
      hasMore: false,
      reorged: result.reorged,
      safeHead: result.safeHead,
      apply: (previous: MessagesByContact) => reconcileDirectTradeV2ChatMessages({
        previous,
        entries,
        chainId: scope.chainId,
        contractAddress: scope.contractAddress,
        viewerAddress: owner
      })
    });
    return { batch, state: result.state, caughtUp: true };
  };

  const sync = (): Promise<DirectTradeV2RuntimeSyncBatch> => exclusive(async () => {
    const result = await syncScope();
    await assertCurrent();
    if (!alive) throw new Error('Direct Trade V2 runtime is closed.');
    Object.assign(record, { state: result.state, caughtUp: result.caughtUp });
    return result.batch;
  });

  const execute = async (action: DirectTradeV2Action): Promise<ConfirmedDirectTradeV2Action> => {
    const intent = captureWalletActionIntent(action);
    const boundAction = readWalletActionIntent(intent);
    assertCurrentP2PDirectActionAdmission(deployment, boundAction.kind, config.actionAdmission);
    return exclusive(
      () => runOwnerTransactionFlow(async () => {
        if (!alive) throw new Error('Direct Trade V2 runtime is closed.');
        const capability = await getOwnerCapability(actionNeedsPrivacy(boundAction));
        if (!alive) throw new Error('Direct Trade V2 runtime closed before submission.');
        await ensureDirectTradeV2ActionAllowance({ capability, deployment, action: boundAction, actionAdmission: config.actionAdmission });
        if (!alive) throw new Error('Direct Trade V2 runtime closed before submission.');
        const submission = await submitDirectTradeV2Action({ capability, deployment, action: boundAction, actionAdmission: config.actionAdmission });
        return confirmDirectTradeV2Action(submission);
      })
    );
  };

  const readTradeTerms = (
    tradeId: bigint | number | string,
    options?: Readonly<{ decryptPrivateAmounts?: boolean }>
  ): Promise<DirectTradeV2TradeTerms> => exclusive(async () => {
    const publicTerms = await readDirectTradeV2PublicTradeTerms({
      capability: readCapability,
      deployment,
      ownerAddress: owner,
      tradeId
    });
    if (publicTerms.amountMode === 'public' || options?.decryptPrivateAmounts !== true) {
      return publicTerms;
    }
    const privateCapability = await getOwnerCapability(true);
    return readDirectTradeV2TradeTerms({
      capability: privateCapability,
      readCapability,
      deployment,
      tradeId,
      decryptPrivateAmounts: true
    });
  });

  const runtime = Object.freeze({
    contractAddress: deployment.contractAddress,
    deployment,
    ownerAddress: owner,
    supportedContracts: Object.freeze([deployment.contractAddress]),
    sync,
    readTradeTerms,
    execute,
    isCurrent: () => alive,
    close: () => { alive = false; }
  }) as DirectTradeV2Runtime;
  RUNTIMES.add(runtime);
  return runtime;
};

export const resolveDirectTradeV2RuntimeReference = async (
  runtime: DirectTradeV2Runtime | null,
  reference: TradeHistoryV2OrderRef
): Promise<DirectTradeV2Runtime> => {
  if (!runtime?.isCurrent()) throw new Error('Reconnect the owner browser wallet to manage this Direct V2 offer.');
  if (!runtime.isCurrent() || reference.chainId !== runtime.deployment.chainId ||
      reference.contractAddress.toLowerCase() !== runtime.contractAddress.toLowerCase() ||
      !/^[1-9][0-9]*$/.test(reference.orderId) || BigInt(reference.orderId) >= (1n << 256n)) {
    throw new Error('Direct Trade V2 reference is outside this runtime scope.');
  }
  return runtime;
};

export const assertDirectTradeV2Runtime = (
  runtime: DirectTradeV2Runtime
): DirectTradeV2Runtime => {
  if (!runtime || !RUNTIMES.has(runtime)) {
    throw new Error('Direct Trade V2 requires a runtime created by its verified factory.');
  }
  return runtime;
};
