import { getAddress, type Eip1193Provider } from '@coti-io/coti-ethers';
import { CURRENT_OTC_HISTORY_PROTOCOLS, type CurrentOtcHistoryProtocol, type OtcV2DeploymentCatalog } from './otcV2DeploymentCatalog';
import {
  readDirectTradeV2TradeTerms,
  type DirectTradeV2TradeTerms
} from './directTradeV2Actions';
import {
  attestTradeHistoryV2Deployments,
  bindTradeHistoryV2ReadCapability,
  clearCanonicalTradeHistoryV2ReadObservation,
  observeCanonicalTradeHistoryV2Read,
  readTradeHistoryV2CanonicalBlock,
  readTradeHistoryV2WalletIndex,
  TRADE_HISTORY_V2_MAX_LOG_RANGE_BLOCKS,
  type AttestedTradeHistoryV2Deployment,
  type TradeHistoryV2ReadCapability
} from './tradeHistoryV2Chain';
import {
  aggregateTradeHistoryV2Rows,
  createTradeHistoryV2LedgerState,
  getTradeHistoryV2LedgerRevision,
  projectTradeHistoryV2Rows,
  type TradeHistoryV2ExecutionRow,
  type TradeHistoryV2OrderAggregate,
  type TradeHistoryV2Protocol
} from './tradeHistoryV2Ledger';
import {
  createTradeHistoryV2MaterializationState,
  getTradeHistoryV2MaterializationRevision,
  listTradeHistoryV2LifecycleEvents,
  type TradeHistoryV2CanonicalLifecycleEvent,
  type TradeHistoryV2DirectPrivateAmountResolver,
  type TradeHistoryV2PrivateAmountResolver
} from './tradeHistoryV2Materialize';
import {
  syncTradeHistoryV2PipelineRange,
  resetTradeHistoryV2Projection,
  type TradeHistoryV2PipelineState
} from './tradeHistoryV2Pipeline';
import { createTradeHistoryV2SyncState } from './tradeHistoryV2Sync';
import type { OwnerTradeV2MetaMaskCapability } from './ownerTradeV2Capability';
import { decryptPrivateTradeV2ReceiptAmounts } from './privateTradeV2ReceiptResolver';

type ActiveCatalog = Extract<OtcV2DeploymentCatalog, { status: 'active' }>;
type ReadProvider = Pick<Eip1193Provider, 'request'>;
type PrivateReadScope = Readonly<{ key: string; enabled: boolean }>;

export type OtcTradeHistoryV2SyncResult = Readonly<{
  applied: boolean;
  hasMore: boolean;
  reorged: boolean;
  byProtocol: Readonly<Partial<Record<TradeHistoryV2Protocol, Readonly<{
    applied: boolean;
    hasMore: boolean;
    reorged: boolean;
    safeHead: string;
  }>>>>;
}>;

declare const OTC_TRADE_HISTORY_V2_RUNTIME_BRAND: unique symbol;
export type OtcTradeHistoryV2Runtime = Readonly<{
  readonly [OTC_TRADE_HISTORY_V2_RUNTIME_BRAND]: true;
  ownerAddress: string;
  readCapability: TradeHistoryV2ReadCapability;
  deployments: Readonly<Record<CurrentOtcHistoryProtocol, AttestedTradeHistoryV2Deployment>>;
  sync(contractAddresses?: readonly string[], mode?: 'latest' | 'older'): Promise<OtcTradeHistoryV2SyncResult>;
  rows(): readonly TradeHistoryV2ExecutionRow[];
  lifecycleEvents(): readonly TradeHistoryV2CanonicalLifecycleEvent[];
  orders(): readonly TradeHistoryV2OrderAggregate[];
  readDirectTerms(
    capability: OwnerTradeV2MetaMaskCapability,
    tradeId: bigint | number | string,
    decryptPrivateAmounts?: boolean
  ): Promise<DirectTradeV2TradeTerms>;
  isCurrent(): boolean;
  close(): void;
}>;

const RUNTIMES = new WeakSet<object>();

const createPipelineState = (): TradeHistoryV2PipelineState => Object.freeze({
  sync: createTradeHistoryV2SyncState(createTradeHistoryV2LedgerState()),
  materialization: createTradeHistoryV2MaterializationState()
});

const executionOrder = (left: TradeHistoryV2ExecutionRow, right: TradeHistoryV2ExecutionRow): number => {
  const block = BigInt(left.log.blockNumber) - BigInt(right.log.blockNumber);
  if (block !== 0n) return block < 0n ? -1 : 1;
  if (left.log.transactionIndex !== right.log.transactionIndex) {
    return left.log.transactionIndex - right.log.transactionIndex;
  }
  if (left.log.logIndex !== right.log.logIndex) return left.log.logIndex - right.log.logIndex;
  return left.key.localeCompare(right.key);
};

export const projectOtcTradeHistoryV2Portfolio = ({
  states,
  viewerAddress
}: {
  states: Readonly<Record<string, TradeHistoryV2PipelineState>>;
  viewerAddress: string;
}): Readonly<{
  rows: readonly TradeHistoryV2ExecutionRow[];
  orders: readonly TradeHistoryV2OrderAggregate[];
}> => {
  const viewer = getAddress(viewerAddress).toLowerCase();
  const rows = Object.values(states).flatMap((state) => projectTradeHistoryV2Rows({
    state: state.sync.ledger,
    viewerAddress: viewer
  })).sort(executionOrder);
  return Object.freeze({
    rows: Object.freeze(rows),
    orders: Object.freeze(aggregateTradeHistoryV2Rows(rows))
  });
};

export const createOtcTradeHistoryV2Runtime = async ({
  catalog,
  ownerAddress,
  provider,
  assertCurrent,
  resolvePrivateReceiptAmounts,
  resolveDirectPrivateAmounts,
  getOwnerCapability,
  getPrivateReadScope,
  maxBlockSpan = TRADE_HISTORY_V2_MAX_LOG_RANGE_BLOCKS,
  overlapBlocks = 16n
}: {
  catalog: ActiveCatalog;
  ownerAddress: string;
  provider: ReadProvider;
  assertCurrent: () => void | Promise<void>;
  resolvePrivateReceiptAmounts?: TradeHistoryV2PrivateAmountResolver;
  resolveDirectPrivateAmounts?: TradeHistoryV2DirectPrivateAmountResolver;
  getOwnerCapability?: () => Promise<OwnerTradeV2MetaMaskCapability>;
  getPrivateReadScope?: () => PrivateReadScope;
  maxBlockSpan?: bigint;
  overlapBlocks?: bigint;
}): Promise<OtcTradeHistoryV2Runtime> => {
  if (!catalog || catalog.status !== 'active') {
    throw new Error('OTC V2 history runtime requires an active deployment catalog.');
  }
  const owner = getAddress(ownerAddress).toLowerCase();
  let alive = true;
  let observationPrivateScope: PrivateReadScope | undefined;
  const isObservationCurrent = () => {
    const current = getPrivateReadScope?.();
    return alive && current?.key === observationPrivateScope?.key && current?.enabled === observationPrivateScope?.enabled;
  };
  const capability = await bindTradeHistoryV2ReadCapability({
    provider,
    expectedChainId: BigInt(catalog.chainId),
    assertCurrent: async () => {
      if (!alive) throw new Error('OTC V2 history runtime is closed.');
      await assertCurrent();
    },
    isObservationCurrent
  });
  const deploymentKey = (item: { chainId: string; contractAddress: string }) => `${item.chainId}:${item.contractAddress.toLowerCase()}`;
  const descriptors = new Map<string, ActiveCatalog['deployments'][CurrentOtcHistoryProtocol]>();
  for (const protocol of CURRENT_OTC_HISTORY_PROTOCOLS) {
    const descriptor = catalog.deployments[protocol];
    if (!descriptor || descriptor.protocol !== protocol || descriptor.manifest.protocol !== protocol)
      throw new Error('Current OTC history deployment is missing or has another protocol.');
    const key = deploymentKey(descriptor.manifest), previous = descriptors.get(key);
    if (previous && (previous.protocol !== descriptor.protocol || previous.manifest.runtimeBytecodeHash !== descriptor.manifest.runtimeBytecodeHash ||
        previous.manifest.deploymentBlock !== descriptor.manifest.deploymentBlock)) throw new Error('OTC history deployment identity is ambiguous.');
    descriptors.set(key, descriptor);
  }
  const entries = [...descriptors];
  const verified = await attestTradeHistoryV2Deployments({
    capability, manifests: entries.map(([, descriptor]) => descriptor.manifest), finalityLagBlocks: catalog.finalityLagBlocks
  });
  const attested = entries.map(([key], index) => [key, verified[index]] as const);
  const historyDeployments = new Map(attested);
  const deployments = Object.freeze(Object.fromEntries(CURRENT_OTC_HISTORY_PROTOCOLS.map(protocol => [protocol,
    historyDeployments.get(deploymentKey(catalog.deployments[protocol].manifest))!
  ]))) as OtcTradeHistoryV2Runtime['deployments'];
  const deploymentForReceipt = (receipt: { chainId: string; contractAddress: string; protocol: string }) => {
    const deployment = historyDeployments.get(deploymentKey(receipt));
    if (!deployment || deployment.protocol !== receipt.protocol) throw new Error('OTC receipt belongs to another deployment.');
    return deployment;
  };
  const observePrivateRead = (receipt: Parameters<typeof deploymentForReceipt>[0]) => {
    let deployment: AttestedTradeHistoryV2Deployment | undefined;
    try {
      const candidate = historyDeployments.get(deploymentKey(receipt));
      if (candidate?.protocol === receipt.protocol) deployment = candidate;
    } catch { /* Invalid input still follows the original resolver validation. */ }
    return observeCanonicalTradeHistoryV2Read(deployment, 'private', undefined, isObservationCurrent);
  };
  const privateReceiptResolver = resolvePrivateReceiptAmounts ?? (getOwnerCapability
    ? async (receipt: Parameters<TradeHistoryV2PrivateAmountResolver>[0]) => {
        const observe = observePrivateRead(receipt);
        observe('private-capability');
        try {
          const ownerCapability = await getOwnerCapability();
          observe('private-decryption');
          const amounts = await decryptPrivateTradeV2ReceiptAmounts({
            capability: ownerCapability,
            deployment: deploymentForReceipt(receipt),
            receipt
          });
          observe('done');
          return amounts;
        } catch (error) { observe('failed'); throw error; }
      }
    : undefined);
  const directPrivateResolver = resolveDirectPrivateAmounts ?? (getOwnerCapability
    ? async ({ opened }: Parameters<TradeHistoryV2DirectPrivateAmountResolver>[0]) => {
        const observe = observePrivateRead(opened);
        observe('private-capability');
        try {
          const ownerCapability = await getOwnerCapability();
          observe('private-terms');
          const terms = await readDirectTradeV2TradeTerms({
            capability: ownerCapability,
            readCapability: capability,
            deployment: deploymentForReceipt(opened),
            tradeId: opened.orderId,
            decryptPrivateAmounts: true
          });
          if (terms.offerAmount === undefined || terms.requestAmount === undefined) {
            throw new Error('Direct private OTC terms are unavailable to this participant.');
          }
          observe('done');
          return Object.freeze({ offerAmount: terms.offerAmount, requestAmount: terms.requestAmount });
        } catch (error) { observe('failed'); throw error; }
      }
    : undefined);
  let states: Record<string, TradeHistoryV2PipelineState> = Object.fromEntries(attested.map(([key]) => [key, createPipelineState()]));
  const narrowLogScopes = new Set<string>();
  const indexedIds = new Map<string, string>();
  const projectionScopes = new Map<string, PrivateReadScope | undefined>();
  let projectionScope: PrivateReadScope | undefined;
  const privateReadScope = (): PrivateReadScope | undefined => {
    const scope = getPrivateReadScope?.();
    return scope && Object.freeze({ key: scope.key, enabled: scope.enabled });
  };
  const samePrivateReadScope = (left: PrivateReadScope | undefined, right: PrivateReadScope | undefined) =>
    left?.key === right?.key && left?.enabled === right?.enabled;
  const privateScopeIsCurrent = (scope: PrivateReadScope | undefined) => samePrivateReadScope(scope, privateReadScope());
  const assertPrivateScopeCurrent = (scope: PrivateReadScope | undefined) => {
    if (!privateScopeIsCurrent(scope)) throw new Error('OTC history private projection scope changed.');
  };
  const discardStaleProjections = () => {
    const current = privateReadScope();
    if (samePrivateReadScope(projectionScope, current)) return;
    states = Object.fromEntries(Object.entries(states).map(([key, state]) => [key, resetTradeHistoryV2Projection(state)]));
    projectionScope = current;
  };
  let operationTail = Promise.resolve();

  const exclusive = async <T>(operation: () => Promise<T>, commit?: (result: T) => void): Promise<T> => {
    const previous = operationTail;
    let release = () => {};
    operationTail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      if (!alive) throw new Error('OTC V2 history runtime is closed.');
      await assertCurrent();
      const result = await operation();
      await assertCurrent();
      if (!alive) throw new Error('OTC V2 history runtime closed during an operation.');
      commit?.(result);
      return result;
    } finally {
      release();
    }
  };

  const sync = async (contractAddresses?: readonly string[], mode: 'latest' | 'older' = 'latest'): Promise<OtcTradeHistoryV2SyncResult> => {
    const requestedPrivateScope = privateReadScope();
    const requested = contractAddresses && new Set(contractAddresses.map(address => getAddress(address).toLowerCase()));
    const requestedKeys = requested && new Set([...requested].map(address => `${catalog.chainId}:${address}`));
    // Reject unknown sources before any history read.
    if (requestedKeys && (requestedKeys.size === 0 || [...requestedKeys].some(key => !descriptors.has(key)))) {
      throw new Error('OTC history scope must name selected catalog deployments.');
    }
    return exclusive(async () => {
    assertPrivateScopeCurrent(requestedPrivateScope);
    observationPrivateScope = requestedPrivateScope;
    discardStaleProjections();
    const previousStates = states;
    const selected = requested ? attested.filter(([, deployment]) => requested.has(deployment.contractAddress)) : attested;
    if (requested && (requested.size === 0 || selected.length !== requested.size)) {
      throw new Error('OTC history scope must name attested deployments.');
    }
    const pending = await Promise.all(selected.map(async ([key, deployment]) => {
      const walletIndex = await readTradeHistoryV2WalletIndex({ capability, deployment, ownerAddress: owner });
      assertPrivateScopeCurrent(requestedPrivateScope);
      const idsKey = walletIndex.complete === false ? 'all-events' : walletIndex.orderIds.join(',');
      const changed = indexedIds.has(key) && indexedIds.get(key) !== idsKey;
      // A first fill can add an older order. Backfill its opening and prior receipts too.
      const previous = changed ? createPipelineState() : previousStates[key];
      if (walletIndex.complete !== false && walletIndex.orderIds.length === 0) {
        return [key, { status: 'page-applied' as const, state: createPipelineState(),
          hasMore: false, reorged: false, safeHead: walletIndex.block.number }, deployment.protocol, idsKey] as const;
      }
      const scope = Object.freeze({
        chainId: deployment.chainId,
        contractAddress: deployment.contractAddress,
        deploymentBlock: deployment.deploymentBlock
      });
      const result = await syncTradeHistoryV2PipelineRange({
        previous,
        mode,
        rebuildProjection: !changed && projectionScopes.has(key) && !samePrivateReadScope(projectionScopes.get(key), requestedPrivateScope),
        scope,
        capability,
        deployment,
        walletIndex,
        confirmationDepth: catalog.finalityLagBlocks,
        maxBlockSpan: narrowLogScopes.has(key) && maxBlockSpan > TRADE_HISTORY_V2_MAX_LOG_RANGE_BLOCKS
          ? TRADE_HISTORY_V2_MAX_LOG_RANGE_BLOCKS : maxBlockSpan,
        overlapBlocks,
        reads: {
          getLatestBlockNumber: async () => (BigInt(walletIndex.block.number) + catalog.finalityLagBlocks).toString(),
          readCanonicalBlock: async (_chainId, blockNumber) => readTradeHistoryV2CanonicalBlock({
            capability,
            blockNumber: BigInt(blockNumber),
            observationDeployment: deployment
          })
        },
        viewer: owner,
        resolvePrivateReceiptAmounts: requestedPrivateScope?.enabled === false ? undefined : privateReceiptResolver,
        resolveDirectPrivateAmounts: requestedPrivateScope?.enabled === false ? undefined : directPrivateResolver,
        expectedLedgerRevision: getTradeHistoryV2LedgerRevision({
          state: previous.sync.ledger,
          chainId: scope.chainId,
          contractAddress: scope.contractAddress
        }),
        expectedMaterializationRevision: getTradeHistoryV2MaterializationRevision({
          state: previous.materialization,
          chainId: scope.chainId,
          contractAddress: scope.contractAddress
        }),
        shouldContinue: () => alive && privateScopeIsCurrent(requestedPrivateScope)
      });
      return [key, result, deployment.protocol, idsKey] as const;
    }));
    await assertCurrent();
    assertPrivateScopeCurrent(requestedPrivateScope);
    if (!alive) throw new Error('OTC V2 history runtime closed before commit.');
    const scannedProtocols = [...new Set(selected.map(([, deployment]) => deployment.protocol))];
    const byProtocol = Object.freeze(Object.fromEntries(scannedProtocols.map(protocol => {
      const results = pending.filter(([, , type]) => type === protocol).map(([, result]) => result);
      return [protocol, Object.freeze({
        applied: results.some(result => result.status !== 'up-to-date' || result.reorged),
        hasMore: results.some(result => result.hasMore),
        reorged: results.some(result => result.reorged),
        safeHead: results.map(result => result.safeHead).reduce((left, right) => BigInt(left) < BigInt(right) ? left : right)
      })];
    }))) as OtcTradeHistoryV2SyncResult['byProtocol'];
    const summary = Object.freeze({
      applied: Object.values(byProtocol).some(({ applied }) => applied),
      hasMore: Object.values(byProtocol).some(({ hasMore }) => hasMore),
      reorged: Object.values(byProtocol).some(({ reorged }) => reorged),
      byProtocol
    });
    return { summary, states: { ...previousStates, ...Object.fromEntries(pending.map(([key, result]) => [key, result.state])) },
      projectedScopes: selected.map(([key]) => key),
      indexedIds: pending.map(([key, , , idsKey]) => [key, idsKey] as const),
      narrowedScopes: pending.filter(([, result]) => 'narrowedForLogLimit' in result && result.narrowedForLogLimit).map(([key]) => key) };
    }, staged => {
      assertPrivateScopeCurrent(requestedPrivateScope);
      states = staged.states;
      staged.indexedIds.forEach(([key, idsKey]) => indexedIds.set(key, idsKey));
      staged.narrowedScopes.forEach(key => narrowLogScopes.add(key));
      staged.projectedScopes.forEach(key => projectionScopes.set(key, requestedPrivateScope));
    }).then(staged => staged.summary);
  };

  const hasCurrentProjection = (key: string) => alive && projectionScopes.has(key) && privateScopeIsCurrent(projectionScopes.get(key));
  const portfolio = () => {
    discardStaleProjections();
    return projectOtcTradeHistoryV2Portfolio({
      states: Object.fromEntries(Object.entries(states).filter(([key]) => hasCurrentProjection(key))), viewerAddress: owner
    });
  };
  const lifecycleEvents = (): readonly TradeHistoryV2CanonicalLifecycleEvent[] => {
    discardStaleProjections();
    return Object.freeze(
      attested.filter(([key]) => hasCurrentProjection(key)).flatMap(([key, deployment]) => {
        return listTradeHistoryV2LifecycleEvents({
          state: states[key].materialization,
          chainId: deployment.chainId,
          contractAddress: deployment.contractAddress
        });
      }).sort((left, right) => {
        const blockOrder = BigInt(left.log.blockNumber) - BigInt(right.log.blockNumber);
        if (blockOrder !== 0n) return blockOrder < 0n ? -1 : 1;
        if (left.log.transactionIndex !== right.log.transactionIndex) {
          return left.log.transactionIndex - right.log.transactionIndex;
        }
        return left.log.logIndex - right.log.logIndex;
      })
    );
  };
  const runtime = Object.freeze({
    ownerAddress: owner,
    readCapability: capability,
    deployments,
    sync,
    rows: () => portfolio().rows,
    lifecycleEvents,
    orders: () => portfolio().orders,
    readDirectTerms: (
      ownerCapability: OwnerTradeV2MetaMaskCapability,
      tradeId: bigint | number | string,
      decryptPrivateAmounts = false
    ): Promise<DirectTradeV2TradeTerms> =>
      readDirectTradeV2TradeTerms({
        capability: ownerCapability,
        readCapability: capability,
        deployment: deployments['direct-v2'],
        tradeId,
        decryptPrivateAmounts
      }),
    isCurrent: () => alive,
    close: () => {
      alive = false;
      states = {};
      projectionScopes.clear();
      indexedIds.clear();
      Object.values(deployments).forEach(deployment => clearCanonicalTradeHistoryV2ReadObservation(deployment, isObservationCurrent));
    }
  }) as unknown as OtcTradeHistoryV2Runtime;
  RUNTIMES.add(runtime);
  return runtime;
};

export const assertOtcTradeHistoryV2Runtime = (
  runtime: OtcTradeHistoryV2Runtime
): OtcTradeHistoryV2Runtime => {
  if (!runtime || !RUNTIMES.has(runtime)) {
    throw new Error('OTC V2 history requires a runtime created by its verified factory.');
  }
  return runtime;
};
