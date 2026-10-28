import { getAddress, type Eip1193Provider } from '@coti-io/coti-ethers';
import type { OtcV2Deployment, OtcV2DeploymentCatalog } from './otcV2DeploymentCatalog';
import {
  readDirectTradeV2TradeTerms,
  type DirectTradeV2TradeTerms
} from './directTradeV2Actions';
import {
  attestTradeHistoryV2Deployments,
  bindTradeHistoryV2ReadCapability,
  readTradeHistoryV2CanonicalBlock,
  readTradeHistoryV2LatestBlockNumber,
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
  type TradeHistoryV2PipelineState
} from './tradeHistoryV2Pipeline';
import { createTradeHistoryV2SyncState } from './tradeHistoryV2Sync';
import type { OwnerTradeV2MetaMaskCapability } from './ownerTradeV2Capability';
import { decryptPrivateTradeV2ReceiptAmounts } from './privateTradeV2ReceiptResolver';

const PROTOCOLS = Object.freeze([
  'standard-v2',
  'private-v2',
  'direct-v2',
  'recurring-v2',
  'private-recurring-v2'
] as const satisfies readonly TradeHistoryV2Protocol[]);

type ActiveCatalog = Extract<OtcV2DeploymentCatalog, { status: 'active' }>;
type ReadProvider = Pick<Eip1193Provider, 'request'>;

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
  deployments: Readonly<Record<TradeHistoryV2Protocol, AttestedTradeHistoryV2Deployment>>;
  retainedDeployments?: readonly AttestedTradeHistoryV2Deployment[];
  sync(contractAddresses?: readonly string[]): Promise<OtcTradeHistoryV2SyncResult>;
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
  maxBlockSpan?: bigint;
  overlapBlocks?: bigint;
}): Promise<OtcTradeHistoryV2Runtime> => {
  if (!catalog || catalog.status !== 'active') {
    throw new Error('OTC V2 history runtime requires an active deployment catalog.');
  }
  const owner = getAddress(ownerAddress).toLowerCase();
  const capability = await bindTradeHistoryV2ReadCapability({
    provider,
    expectedChainId: BigInt(catalog.chainId),
    assertCurrent
  });
  const deploymentKey = (item: { chainId: string; contractAddress: string }) => `${item.chainId}:${item.contractAddress.toLowerCase()}`;
  const descriptors = new Map<string, ActiveCatalog['deployments'][TradeHistoryV2Protocol]>();
  for (const descriptor of [...Object.values(catalog.deployments),
    ...Object.values(catalog.preparedP2p && catalog.preparedP2p.status !== 'prepared' ? catalog.preparedP2p.retainedDeployments : {})
      .filter((descriptor): descriptor is OtcV2Deployment => descriptor.protocol !== 'link-v2' && descriptor.protocol !== 'counter-v2')]) {
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
  const deployments = Object.freeze(Object.fromEntries(PROTOCOLS.map(protocol => [protocol,
    historyDeployments.get(deploymentKey(catalog.deployments[protocol].manifest))!
  ]))) as OtcTradeHistoryV2Runtime['deployments'];
  const deploymentForReceipt = (receipt: { chainId: string; contractAddress: string; protocol: string }) => {
    const deployment = historyDeployments.get(deploymentKey(receipt));
    if (!deployment || deployment.protocol !== receipt.protocol) throw new Error('OTC receipt belongs to another deployment.');
    return deployment;
  };
  const privateReceiptResolver = resolvePrivateReceiptAmounts ?? (getOwnerCapability
    ? async (receipt: Parameters<TradeHistoryV2PrivateAmountResolver>[0]) =>
        decryptPrivateTradeV2ReceiptAmounts({
          capability: await getOwnerCapability(),
          deployment: deploymentForReceipt(receipt),
          receipt
        })
    : undefined);
  const directPrivateResolver = resolveDirectPrivateAmounts ?? (getOwnerCapability
    ? async ({ opened }: Parameters<TradeHistoryV2DirectPrivateAmountResolver>[0]) => {
        const terms = await readDirectTradeV2TradeTerms({
          capability: await getOwnerCapability(),
          readCapability: capability,
          deployment: deploymentForReceipt(opened),
          tradeId: opened.orderId,
          decryptPrivateAmounts: true
        });
        if (terms.offerAmount === undefined || terms.requestAmount === undefined) {
          throw new Error('Direct private OTC terms are unavailable to this participant.');
        }
        return Object.freeze({ offerAmount: terms.offerAmount, requestAmount: terms.requestAmount });
      }
    : undefined);
  let states: Record<string, TradeHistoryV2PipelineState> = Object.fromEntries(attested.map(([key]) => [key, createPipelineState()]));
  let alive = true;
  let operationTail = Promise.resolve();

  const exclusive = async <T>(operation: () => Promise<T>): Promise<T> => {
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
      return result;
    } finally {
      release();
    }
  };

  const sync = (contractAddresses?: readonly string[]): Promise<OtcTradeHistoryV2SyncResult> => exclusive(async () => {
    const requested = contractAddresses && new Set(contractAddresses.map(address => getAddress(address).toLowerCase()));
    const selected = requested ? attested.filter(([, deployment]) => requested.has(deployment.contractAddress)) : attested;
    if (requested && (requested.size === 0 || selected.length !== requested.size)) {
      throw new Error('OTC history scope must name attested deployments.');
    }
    const pending = await Promise.all(selected.map(async ([key, deployment]) => {
      const scope = Object.freeze({
        chainId: deployment.chainId,
        contractAddress: deployment.contractAddress,
        deploymentBlock: deployment.deploymentBlock
      });
      const result = await syncTradeHistoryV2PipelineRange({
        previous: states[key],
        scope,
        capability,
        deployment,
        confirmationDepth: catalog.finalityLagBlocks,
        maxBlockSpan,
        overlapBlocks,
        reads: {
          getLatestBlockNumber: () => readTradeHistoryV2LatestBlockNumber(capability),
          readCanonicalBlock: async (_chainId, blockNumber) => readTradeHistoryV2CanonicalBlock({
            capability,
            blockNumber: BigInt(blockNumber)
          })
        },
        viewer: owner,
        resolvePrivateReceiptAmounts: privateReceiptResolver,
        resolveDirectPrivateAmounts: directPrivateResolver,
        expectedLedgerRevision: getTradeHistoryV2LedgerRevision({
          state: states[key].sync.ledger,
          chainId: scope.chainId,
          contractAddress: scope.contractAddress
        }),
        expectedMaterializationRevision: getTradeHistoryV2MaterializationRevision({
          state: states[key].materialization,
          chainId: scope.chainId,
          contractAddress: scope.contractAddress
        }),
        shouldContinue: () => alive
      });
      return [key, result, deployment.protocol] as const;
    }));
    await assertCurrent();
    if (!alive) throw new Error('OTC V2 history runtime closed before commit.');
    states = { ...states, ...Object.fromEntries(pending.map(([key, result]) => [key, result.state])) };
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
    return Object.freeze({
      applied: Object.values(byProtocol).some(({ applied }) => applied),
      hasMore: Object.values(byProtocol).some(({ hasMore }) => hasMore),
      reorged: Object.values(byProtocol).some(({ reorged }) => reorged),
      byProtocol
    });
  });

  const portfolio = () => projectOtcTradeHistoryV2Portfolio({ states, viewerAddress: owner });
  const lifecycleEvents = (): readonly TradeHistoryV2CanonicalLifecycleEvent[] => Object.freeze(
    attested.flatMap(([key, deployment]) => {
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
  const runtime = Object.freeze({
    ownerAddress: owner,
    readCapability: capability,
    deployments,
    retainedDeployments: Object.freeze(attested.map(([, deployment]) => deployment).filter(deployment =>
      !Object.values(deployments).some(selected => selected.chainId === deployment.chainId && selected.contractAddress === deployment.contractAddress))),
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
    close: () => { alive = false; }
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
