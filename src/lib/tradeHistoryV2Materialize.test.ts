import { Interface, keccak256, toUtf8Bytes, type Eip1193Provider } from '@coti-io/coti-ethers';
import { describe, expect, it, vi } from 'vitest';
import {
  attestTradeHistoryV2Deployment,
  bindTradeHistoryV2ReadCapability,
  readCanonicalTradeHistoryV2LogRange,
  type AttestedTradeHistoryV2Deployment,
  type CanonicalTradeHistoryV2LogRange,
  type TradeHistoryV2ReadCapability
} from './tradeHistoryV2Chain';
import {
  TRADE_HISTORY_V2_EVENT_ABIS,
  type TradeHistoryV2EventProtocol
} from './tradeHistoryV2Events';
import {
  clearTradeHistoryV2MaterializationScope,
  createTradeHistoryV2MaterializationState,
  getTradeHistoryV2MaterializationRevision,
  listTradeHistoryV2DirectChatEntries,
  listTradeHistoryV2LifecycleEvents,
  materializeCanonicalTradeHistoryV2Range
} from './tradeHistoryV2Materialize';
import {
  syncTradeHistoryV2PipelineRange,
  type TradeHistoryV2PipelineReadDependencies
} from './tradeHistoryV2Pipeline';
import {
  createTradeHistoryV2LedgerState,
  projectTradeHistoryV2Rows
} from './tradeHistoryV2Ledger';
import { createTradeHistoryV2SyncState } from './tradeHistoryV2Sync';
import currentArtifact from '../../tests/fixtures/validation-ChainWhisperPrivateOTCEscrowV2.json';

const address = (pair: string): string => `0x${pair.repeat(20)}`;
const hash = (pair: string): string => `0x${pair.repeat(32)}`;
const quantity = (value: bigint | number): string => `0x${BigInt(value).toString(16)}`;
const blockHash = (number: bigint, suffix = 0n): string =>
  `0x${(number * 256n + suffix).toString(16).padStart(64, '0')}`;
const encryptedUint256 = (userHigh: bigint, userLow = 0n) =>
  [[1n, 2n], [userHigh, userLow]] as const;

const CHAIN_ID = 7_082_400n;
const CONTRACT = address('11');
const OTHER_CONTRACT = address('12');
const MAKER = address('22');
const FILLER = address('33');
const OUTSIDER = address('44');
const ZERO_ADDRESS = address('00');
const CODE = '0x6001600055';
const DEPLOYMENT_BLOCK = 100n;
const LATEST = 200n;
const FINALITY_LAG = 5n;
const APP_WALLET_FEATURE = keccak256(toUtf8Bytes('APP_WALLET_EXECUTOR')).toLowerCase();

const VERSIONS: Record<TradeHistoryV2EventProtocol, string> = {
  'standard-v2': 'ChainWhisperStandardOTCEscrowV2',
  'private-v2': 'ChainWhisperPrivateOTCEscrowV2',
  'direct-v2': 'ChainWhisperDirectOTCEscrowV2',
  'recurring-v2': 'ChainWhisperRecurringOTCEscrowV2',
  'private-recurring-v2': 'ChainWhisperPrivateRecurringOTCEscrowV2'
};

const EVENT_INTERFACES = {
  'standard-v2': new Interface(TRADE_HISTORY_V2_EVENT_ABIS.standard),
  'private-v2': new Interface(currentArtifact.abi),
  'direct-v2': new Interface(TRADE_HISTORY_V2_EVENT_ABIS.direct),
  'recurring-v2': new Interface(TRADE_HISTORY_V2_EVENT_ABIS.recurring),
  'private-recurring-v2': new Interface(TRADE_HISTORY_V2_EVENT_ABIS.privateRecurring)
} as const;

const METADATA = new Interface([
  'function contractVersion() view returns (string)',
  'function supportsFeature(bytes32 feature) view returns (bool)'
]);

type RpcLog = Record<string, unknown>;

class Provider implements Pick<Eip1193Provider, 'request'> {
  readonly protocol: TradeHistoryV2EventProtocol;
  logs: RpcLog[] = [];
  blocks = new Map<string, { hash: string; transactions: string[] }>();
  receipts = new Map<string, Record<string, unknown>>();

  constructor(protocol: TradeHistoryV2EventProtocol) {
    this.protocol = protocol;
  }

  addLog({
    eventName,
    args,
    blockNumber,
    transactionHash,
    transactionIndex = 0,
    logIndex,
    hashSuffix = 0n
  }: {
    eventName: string;
    args: readonly unknown[];
    blockNumber: bigint;
    transactionHash: string;
    transactionIndex?: number;
    logIndex: number;
    hashSuffix?: bigint;
  }): RpcLog {
    const event = EVENT_INTERFACES[this.protocol].getEvent(eventName);
    if (!event) throw new Error(`Missing event ${eventName}.`);
    const encoded = EVENT_INTERFACES[this.protocol].encodeEventLog(event, [...args]);
    const block = this.blocks.get(blockNumber.toString()) ?? {
      hash: blockHash(blockNumber, hashSuffix),
      transactions: []
    };
    while (block.transactions.length <= transactionIndex) block.transactions.push(hash('ee'));
    block.transactions[transactionIndex] = transactionHash.toLowerCase();
    this.blocks.set(blockNumber.toString(), block);
    const raw = {
      address: CONTRACT,
      topics: encoded.topics,
      data: encoded.data,
      blockNumber: quantity(blockNumber),
      blockHash: block.hash,
      transactionHash: transactionHash.toLowerCase(),
      transactionIndex: quantity(transactionIndex),
      logIndex: quantity(logIndex),
      removed: false
    };
    const existing = this.receipts.get(transactionHash.toLowerCase()) ?? {
      status: '0x1',
      blockNumber: quantity(blockNumber),
      blockHash: block.hash,
      transactionHash: transactionHash.toLowerCase(),
      transactionIndex: quantity(transactionIndex),
      logs: []
    };
    (existing.logs as RpcLog[]).push({ ...raw, removed: undefined });
    this.receipts.set(transactionHash.toLowerCase(), existing);
    return raw;
  }

  private block(number: bigint) {
    const configured = this.blocks.get(number.toString()) ?? {
      hash: blockHash(number),
      transactions: []
    };
    return { number: quantity(number), hash: configured.hash, transactions: [...configured.transactions] };
  }

  async request({ method, params = [] }: { method: string; params?: readonly unknown[] }): Promise<unknown> {
    if (method === 'eth_chainId') return quantity(CHAIN_ID);
    if (method === 'eth_blockNumber') return quantity(LATEST);
    if (method === 'eth_getBlockByNumber') return this.block(BigInt(String(params[0])));
    if (method === 'eth_getCode') return this.protocol === 'private-v2' ? currentArtifact.deployedBytecode : CODE;
    if (method === 'eth_getLogs') return [...this.logs];
    if (method === 'eth_getTransactionReceipt') {
      return this.receipts.get(String(params[0]).toLowerCase()) ?? null;
    }
    if (method === 'eth_call') {
      const call = params[0] as { data: string };
      const parsed = METADATA.parseTransaction({ data: call.data });
      if (!parsed) throw new Error('Unknown metadata call.');
      if (parsed.name === 'contractVersion') {
        return METADATA.encodeFunctionResult(parsed.name, [VERSIONS[this.protocol]]);
      }
      const feature = String(parsed.args[0]).toLowerCase();
      return METADATA.encodeFunctionResult(parsed.name, [feature !== APP_WALLET_FEATURE]);
    }
    throw new Error(`Unexpected RPC method ${method}.`);
  }
}

const setup = async (protocol: TradeHistoryV2EventProtocol): Promise<{
  provider: Provider;
  capability: TradeHistoryV2ReadCapability;
  deployment: AttestedTradeHistoryV2Deployment;
}> => {
  const provider = new Provider(protocol);
  const capability = await bindTradeHistoryV2ReadCapability({
    provider,
    expectedChainId: CHAIN_ID,
    assertCurrent: async () => undefined
  });
  const deployment = await attestTradeHistoryV2Deployment({
    capability,
    manifest: {
      protocol,
      chainId: CHAIN_ID,
      contractAddress: CONTRACT,
      deploymentBlock: DEPLOYMENT_BLOCK,
      runtimeBytecodeHash: keccak256(protocol === 'private-v2' ? currentArtifact.deployedBytecode : CODE)
    },
    finalityLagBlocks: FINALITY_LAG
  });
  return { provider, capability, deployment };
};

const canonical = async (
  context: Awaited<ReturnType<typeof setup>>,
  logs: readonly RpcLog[],
  fromBlock: bigint,
  toBlock: bigint
): Promise<CanonicalTradeHistoryV2LogRange> => {
  context.provider.logs = [...logs];
  return readCanonicalTradeHistoryV2LogRange({
    capability: context.capability,
    deployment: context.deployment,
    fromBlock,
    toBlock
  });
};

const pipelineReads = (provider: Provider): TradeHistoryV2PipelineReadDependencies => ({
  getLatestBlockNumber: async () => LATEST.toString(),
  readCanonicalBlock: async (_chainId, blockNumber) => {
    const raw = await provider.request({
      method: 'eth_getBlockByNumber',
      params: [quantity(BigInt(blockNumber)), false]
    }) as { number: string; hash: string };
    return { number: BigInt(raw.number).toString(), hash: raw.hash };
  }
});

describe('tradeHistoryV2Materialize', () => {
  it('retains canonical opening and replacement linkage in log order', async () => {
    const context = await setup('standard-v2');
    const transactionHash = hash('70');
    const opened = context.provider.addLog({
      eventName: 'StandardTradeOpened',
      args: [
        8n, MAKER, hash('01'), 1, OTHER_CONTRACT, 100n, 1, CONTRACT, 200n,
        [false, 10_000, 200n, 0n, false], 1_700_000_008n, 0n, 1n, 7n
      ],
      blockNumber: 119n,
      transactionHash,
      logIndex: 0
    });
    const replaced = context.provider.addLog({
      eventName: 'StandardTradeReplaced',
      args: [7n, 8n, 7n],
      blockNumber: 119n,
      transactionHash,
      logIndex: 2
    });
    const result = await materializeCanonicalTradeHistoryV2Range({
      previous: createTradeHistoryV2MaterializationState(),
      canonicalPage: await canonical(context, [opened, replaced], 119n, 119n),
      chainId: CHAIN_ID.toString(),
      contractAddress: CONTRACT,
      expectedRevision: 0
    });

    expect(listTradeHistoryV2LifecycleEvents({
      state: result.state,
      chainId: CHAIN_ID.toString(),
      contractAddress: CONTRACT
    })).toMatchObject([
      { lifecycleKind: 'opened', orderId: '8', rootOrderId: '7', log: { logIndex: 0 } },
      { lifecycleKind: 'replacement', orderId: '7', replacementOrderId: '8', log: { logIndex: 2 } }
    ]);
  });

  it('atomically replaces canonical lifecycle events inside an overlapping replay range', async () => {
    const context = await setup('standard-v2');
    const cancelledLog = context.provider.addLog({
      eventName: 'StandardTradeStatusChanged',
      args: [7n, MAKER, 1, 3, MAKER, 0n, 4n],
      blockNumber: 120n,
      transactionHash: hash('71'),
      logIndex: 0
    });
    const first = await materializeCanonicalTradeHistoryV2Range({
      previous: createTradeHistoryV2MaterializationState(),
      canonicalPage: await canonical(context, [cancelledLog], 120n, 120n),
      chainId: CHAIN_ID.toString(),
      contractAddress: CONTRACT,
      expectedRevision: 0
    });
    expect(listTradeHistoryV2LifecycleEvents({
      state: first.state,
      chainId: CHAIN_ID.toString(),
      contractAddress: CONTRACT
    })).toMatchObject([{ kind: 'lifecycle', nextStatus: '3' }]);

    context.provider.blocks.delete('120');
    const expiredLog = context.provider.addLog({
      eventName: 'StandardTradeStatusChanged',
      args: [7n, MAKER, 1, 4, FILLER, 0n, 4n],
      blockNumber: 120n,
      transactionHash: hash('72'),
      logIndex: 0,
      hashSuffix: 1n
    });
    const replayed = await materializeCanonicalTradeHistoryV2Range({
      previous: first.state,
      canonicalPage: await canonical(context, [expiredLog], 120n, 120n),
      chainId: CHAIN_ID.toString(),
      contractAddress: CONTRACT,
      expectedRevision: 1
    });
    const events = listTradeHistoryV2LifecycleEvents({
      state: replayed.state,
      chainId: CHAIN_ID.toString(),
      contractAddress: CONTRACT
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: 'lifecycle', nextStatus: '4', actor: FILLER.toLowerCase(),
      log: { transactionHash: hash('72') }
    });
  });

  it('joins a viewer receipt emitted before its private fill marker and ignores the other recipient', async () => {
    const context = await setup('private-v2');
    const tx = hash('a1');
    const makerReceipt = context.provider.addLog({
      eventName: 'PrivateOrderAccountSnapshotUpdated',
      args: [
        1n, MAKER, FILLER, 3n,
        encryptedUint256(900n), encryptedUint256(1800n), encryptedUint256(800n),
        encryptedUint256(111n), encryptedUint256(222n)
      ],
      blockNumber: 120n,
      transactionHash: tx,
      logIndex: 1
    });
    const fillerReceipt = context.provider.addLog({
      eventName: 'PrivateOrderAccountSnapshotUpdated',
      args: [
        1n, FILLER, FILLER, 3n,
        encryptedUint256(900n), encryptedUint256(1800n), encryptedUint256(800n),
        encryptedUint256(111n), encryptedUint256(222n)
      ],
      blockNumber: 120n,
      transactionHash: tx,
      logIndex: 2
    });
    const marker = context.provider.addLog({
      eventName: 'PrivateOrderFilled',
      args: [1n, FILLER, MAKER, 0, 3n, 2n, 0n, 0n],
      blockNumber: 120n,
      transactionHash: tx,
      logIndex: 3
    });
    const page = await canonical(context, [makerReceipt, fillerReceipt, marker], 120n, 120n);
    const resolver = vi.fn(async () => ({ offerAmount: '100', requestAmount: '200' }));
    const result = await materializeCanonicalTradeHistoryV2Range({
      previous: createTradeHistoryV2MaterializationState(),
      canonicalPage: page,
      chainId: CHAIN_ID.toString(),
      contractAddress: CONTRACT,
      expectedRevision: 0,
      viewer: FILLER,
      resolvePrivateReceiptAmounts: resolver
    });

    expect(resolver).toHaveBeenCalledOnce();
    expect(result.page.observations).toHaveLength(2);
    expect(result.page.observations.map(({ source }) => source)).toEqual([
      'private-marker',
      'participant-receipt'
    ]);
    expect(result.page.observations[1]).toMatchObject({
      recipient: FILLER,
      sequence: '2',
      amounts: { offerAmount: '100', requestAmount: '200' }
    });
  });

  it('does not turn creation or maintenance snapshots into executions without an exact marker', async () => {
    const context = await setup('private-v2');
    const snapshot = context.provider.addLog({
      eventName: 'PrivateOrderAccountSnapshotUpdated',
      args: [
        2n, MAKER, MAKER, 1n,
        encryptedUint256(900n), encryptedUint256(1800n), encryptedUint256(900n),
        encryptedUint256(0n), encryptedUint256(0n)
      ],
      blockNumber: 121n,
      transactionHash: hash('a2'),
      logIndex: 1
    });
    const page = await canonical(context, [snapshot], 121n, 121n);
    const resolver = vi.fn(async () => ({ offerAmount: '900', requestAmount: '1800' }));
    const result = await materializeCanonicalTradeHistoryV2Range({
      previous: createTradeHistoryV2MaterializationState(),
      canonicalPage: page,
      chainId: CHAIN_ID.toString(),
      contractAddress: CONTRACT,
      expectedRevision: 0,
      viewer: MAKER,
      resolvePrivateReceiptAmounts: resolver
    });
    expect(result.page.observations).toEqual([]);
    expect(resolver).not.toHaveBeenCalled();
  });

  it('retains Direct opening terms across pages and counts only the later canonical acceptance', async () => {
    const context = await setup('direct-v2');
    const opened = context.provider.addLog({
      eventName: 'DirectTradeOpened',
      args: [3n, MAKER, FILLER, ZERO_ADDRESS, 0n, 3n, 0, 0, ZERO_ADDRESS, 1, OTHER_CONTRACT, 0, 75n, 120n, 1n, 999999n],
      blockNumber: 110n,
      transactionHash: hash('b1'),
      logIndex: 1
    });
    const openedPage = await canonical(context, [opened], 110n, 110n);
    const first = await materializeCanonicalTradeHistoryV2Range({
      previous: createTradeHistoryV2MaterializationState(),
      canonicalPage: openedPage,
      chainId: CHAIN_ID.toString(),
      contractAddress: CONTRACT,
      expectedRevision: 0,
      viewer: MAKER
    });
    expect(first.page.observations).toEqual([]);
    expect(Object.keys(first.state.directOpeningsByOrderKey)).toHaveLength(1);
    expect(listTradeHistoryV2DirectChatEntries({
      state: first.state,
      chainId: CHAIN_ID.toString(),
      contractAddress: CONTRACT,
      viewer: MAKER
    })).toHaveLength(1);

    const accepted = context.provider.addLog({
      eventName: 'DirectTradeStatusChanged',
      args: [3n, MAKER, FILLER, 1, 2, FILLER, 3n, 1_700_000_003n],
      blockNumber: 120n,
      transactionHash: hash('b2'),
      logIndex: 1
    });
    const acceptedPage = await canonical(context, [accepted], 120n, 120n);
    const second = await materializeCanonicalTradeHistoryV2Range({
      previous: first.state,
      canonicalPage: acceptedPage,
      chainId: CHAIN_ID.toString(),
      contractAddress: CONTRACT,
      expectedRevision: 1,
      viewer: MAKER
    });
    expect(second.page.observations).toHaveLength(1);
    expect(second.page.observations[0]).toMatchObject({
      protocol: 'direct-v2',
      source: 'public-event',
      amounts: { offerAmount: '75', requestAmount: '120' }
    });
    expect(listTradeHistoryV2DirectChatEntries({
      state: second.state,
      chainId: CHAIN_ID.toString(),
      contractAddress: CONTRACT,
      viewer: MAKER
    }).map(({ message }) => message.directTradeV2?.eventKind)).toEqual(['opened', 'status']);
  });

  it('uses participant-only Direct private terms and otherwise emits an amount-free marker', async () => {
    const context = await setup('direct-v2');
    const opened = context.provider.addLog({
      eventName: 'DirectTradeOpened',
      args: [4n, MAKER, FILLER, ZERO_ADDRESS, 0n, 4n, 0, 2, OTHER_CONTRACT, 2, CONTRACT, 1, 0n, 0n, 1n, 999999n],
      blockNumber: 111n,
      transactionHash: hash('c1'),
      logIndex: 1
    });
    const accepted = context.provider.addLog({
      eventName: 'DirectTradeStatusChanged',
      args: [4n, MAKER, FILLER, 1, 2, FILLER, 4n, 1_700_000_004n],
      blockNumber: 112n,
      transactionHash: hash('c2'),
      logIndex: 1
    });
    const page = await canonical(context, [opened, accepted], 111n, 112n);
    const outsider = await materializeCanonicalTradeHistoryV2Range({
      previous: createTradeHistoryV2MaterializationState(),
      canonicalPage: page,
      chainId: CHAIN_ID.toString(),
      contractAddress: CONTRACT,
      expectedRevision: 0,
      viewer: OUTSIDER,
      resolveDirectPrivateAmounts: vi.fn(async () => ({ offerAmount: '55', requestAmount: '89' }))
    });
    expect(outsider.page.observations[0]).toMatchObject({ source: 'private-marker', amounts: {} });

    const participant = await materializeCanonicalTradeHistoryV2Range({
      previous: createTradeHistoryV2MaterializationState(),
      canonicalPage: page,
      chainId: CHAIN_ID.toString(),
      contractAddress: CONTRACT,
      expectedRevision: 0,
      viewer: MAKER,
      resolveDirectPrivateAmounts: async () => ({ offerAmount: '55', requestAmount: '89' })
    });
    expect(participant.page.observations[0]).toMatchObject({
      source: 'participant-receipt',
      recipient: MAKER,
      amounts: { offerAmount: '55', requestAmount: '89' }
    });
  });

  it('replaces Direct openings inside an overlapping replay range before later acceptance', async () => {
    const context = await setup('direct-v2');
    const original = context.provider.addLog({
      eventName: 'DirectTradeOpened',
      args: [5n, MAKER, FILLER, ZERO_ADDRESS, 0n, 5n, 0, 0, ZERO_ADDRESS, 1, OTHER_CONTRACT, 0, 10n, 20n, 1n, 999999n],
      blockNumber: 113n,
      transactionHash: hash('d1'),
      logIndex: 1
    });
    const originalPage = await canonical(context, [original], 113n, 113n);
    const first = await materializeCanonicalTradeHistoryV2Range({
      previous: createTradeHistoryV2MaterializationState(),
      canonicalPage: originalPage,
      chainId: CHAIN_ID.toString(),
      contractAddress: CONTRACT,
      expectedRevision: 0,
      viewer: MAKER
    });

    context.provider.blocks.set('113', { hash: blockHash(113n, 1n), transactions: [] });
    const replacement = context.provider.addLog({
      eventName: 'DirectTradeOpened',
      args: [5n, MAKER, FILLER, ZERO_ADDRESS, 0n, 5n, 0, 0, ZERO_ADDRESS, 1, OTHER_CONTRACT, 0, 30n, 60n, 1n, 999999n],
      blockNumber: 113n,
      transactionHash: hash('d2'),
      logIndex: 1,
      hashSuffix: 1n
    });
    const replacementPage = await canonical(context, [replacement], 113n, 113n);
    const replayed = await materializeCanonicalTradeHistoryV2Range({
      previous: first.state,
      canonicalPage: replacementPage,
      chainId: CHAIN_ID.toString(),
      contractAddress: CONTRACT,
      expectedRevision: 1,
      viewer: MAKER
    });
    const stored = Object.values(replayed.state.directOpeningsByOrderKey);
    expect(stored).toHaveLength(1);
    expect(stored[0].publicAmounts).toEqual({ offerAmount: '30', requestAmount: '60' });
    const cards = listTradeHistoryV2DirectChatEntries({
      state: replayed.state,
      chainId: CHAIN_ID.toString(),
      contractAddress: CONTRACT,
      viewer: MAKER
    });
    expect(cards).toHaveLength(1);
    expect(cards[0].message.txHash).toBe(hash('d2'));
  });

  it('clears only the exact scope and rejects stale or cross-scope materialization', async () => {
    const context = await setup('direct-v2');
    const page = await canonical(context, [], 120n, 120n);
    const initial = createTradeHistoryV2MaterializationState();
    await expect(materializeCanonicalTradeHistoryV2Range({
      previous: {
        directOpeningsByOrderKey: {},
        revisionsByScope: {}
      } as never,
      canonicalPage: page,
      chainId: CHAIN_ID.toString(),
      contractAddress: CONTRACT,
      expectedRevision: 0
    })).rejects.toThrow(/not canonically derived/);
    await expect(materializeCanonicalTradeHistoryV2Range({
      previous: initial,
      canonicalPage: page,
      chainId: CHAIN_ID.toString(),
      contractAddress: CONTRACT,
      expectedRevision: 1
    })).rejects.toThrow(/stale revision/);
    await expect(materializeCanonicalTradeHistoryV2Range({
      previous: initial,
      canonicalPage: page,
      chainId: CHAIN_ID.toString(),
      contractAddress: OTHER_CONTRACT,
      expectedRevision: 0
    })).rejects.toThrow(/another chain or contract/);

    const applied = await materializeCanonicalTradeHistoryV2Range({
      previous: initial,
      canonicalPage: page,
      chainId: CHAIN_ID.toString(),
      contractAddress: CONTRACT,
      expectedRevision: 0
    });
    const cleared = clearTradeHistoryV2MaterializationScope({
      previous: applied.state,
      chainId: CHAIN_ID.toString(),
      contractAddress: CONTRACT,
      expectedRevision: 1
    });
    expect(getTradeHistoryV2MaterializationRevision({
      state: cleared,
      chainId: CHAIN_ID.toString(),
      contractAddress: CONTRACT
    })).toBe(2);
  });

  it('does not commit materialized private amounts after the wallet/scope lease changes', async () => {
    const context = await setup('private-recurring-v2');
    const tx = hash('e1');
    const marker = context.provider.addLog({
      eventName: 'PrivateRecurringOrderExecuted',
      args: [6n, FILLER, MAKER, 0, 1n, 2n],
      blockNumber: 130n,
      transactionHash: tx,
      logIndex: 1
    });
    const receipt = context.provider.addLog({
      eventName: 'PrivateRecurringExecutionReceiptUpdated',
      args: [6n, FILLER, FILLER, 0, 1n, encryptedUint256(111n), encryptedUint256(222n)],
      blockNumber: 130n,
      transactionHash: tx,
      logIndex: 2
    });
    const page = await canonical(context, [marker, receipt], 130n, 130n);
    let current = true;
    await expect(materializeCanonicalTradeHistoryV2Range({
      previous: createTradeHistoryV2MaterializationState(),
      canonicalPage: page,
      chainId: CHAIN_ID.toString(),
      contractAddress: CONTRACT,
      expectedRevision: 0,
      viewer: FILLER,
      shouldContinue: () => current,
      resolvePrivateReceiptAmounts: async () => {
        current = false;
        return { baseAmount: '100', quoteAmount: '200' };
      }
    })).rejects.toThrow(/scope changed/);
  });

  it('atomically commits canonical events, Direct metadata, ledger rows, and checkpoint', async () => {
    const context = await setup('direct-v2');
    const opened = context.provider.addLog({
      eventName: 'DirectTradeOpened',
      args: [7n, MAKER, FILLER, ZERO_ADDRESS, 0n, 7n, 0, 0, ZERO_ADDRESS, 1, OTHER_CONTRACT, 0, 25n, 40n, 1n, 999999n],
      blockNumber: 110n,
      transactionHash: hash('f1'),
      logIndex: 1
    });
    const accepted = context.provider.addLog({
      eventName: 'DirectTradeStatusChanged',
      args: [7n, MAKER, FILLER, 1, 2, FILLER, 7n, 1_700_000_007n],
      blockNumber: 120n,
      transactionHash: hash('f2'),
      logIndex: 1
    });
    context.provider.logs = [opened, accepted];
    const result = await syncTradeHistoryV2PipelineRange({
      previous: {
        sync: createTradeHistoryV2SyncState(createTradeHistoryV2LedgerState()),
        materialization: createTradeHistoryV2MaterializationState()
      },
      scope: {
        chainId: CHAIN_ID.toString(),
        contractAddress: CONTRACT,
        deploymentBlock: DEPLOYMENT_BLOCK.toString()
      },
      capability: context.capability,
      deployment: context.deployment,
      confirmationDepth: FINALITY_LAG,
      maxBlockSpan: 21n,
      overlapBlocks: 1n,
      reads: pipelineReads(context.provider),
      expectedLedgerRevision: 0,
      expectedMaterializationRevision: 0
    });
    expect(result.page).toEqual({ fromBlock: '100', toBlock: '120' });
    expect(result.state.sync.checkpointsByScope).toHaveProperty(
      `chainwhisper-trade-history-v2:${CHAIN_ID}:${CONTRACT}`
    );
    expect(Object.keys(result.state.materialization.directOpeningsByOrderKey)).toHaveLength(1);
    expect(projectTradeHistoryV2Rows({
      state: result.state.sync.ledger,
      viewerAddress: MAKER
    })).toMatchObject([{
      protocol: 'direct-v2',
      amounts: { offerAmount: '25', requestAmount: '40' }
    }]);
  });

  it('atomically clears stale ledger rows and Direct caches before bounded reorg replay', async () => {
    const context = await setup('direct-v2');
    const opened = context.provider.addLog({
      eventName: 'DirectTradeOpened',
      args: [8n, MAKER, FILLER, ZERO_ADDRESS, 0n, 8n, 0, 0, ZERO_ADDRESS, 1, OTHER_CONTRACT, 0, 10n, 20n, 1n, 999999n],
      blockNumber: 110n,
      transactionHash: hash('a8'),
      logIndex: 1
    });
    const accepted = context.provider.addLog({
      eventName: 'DirectTradeStatusChanged',
      args: [8n, MAKER, FILLER, 1, 2, FILLER, 8n, 1_700_000_008n],
      blockNumber: 120n,
      transactionHash: hash('b8'),
      logIndex: 1
    });
    context.provider.logs = [opened, accepted];
    const initial = await syncTradeHistoryV2PipelineRange({
      previous: {
        sync: createTradeHistoryV2SyncState(createTradeHistoryV2LedgerState()),
        materialization: createTradeHistoryV2MaterializationState()
      },
      scope: {
        chainId: CHAIN_ID.toString(), contractAddress: CONTRACT,
        deploymentBlock: DEPLOYMENT_BLOCK.toString()
      },
      capability: context.capability,
      deployment: context.deployment,
      confirmationDepth: FINALITY_LAG,
      maxBlockSpan: 21n,
      overlapBlocks: 1n,
      reads: pipelineReads(context.provider),
      expectedLedgerRevision: 0,
      expectedMaterializationRevision: 0
    });
    expect(projectTradeHistoryV2Rows({ state: initial.state.sync.ledger, viewerAddress: MAKER })).toHaveLength(1);

    context.provider.blocks.set('120', { hash: blockHash(120n, 9n), transactions: [] });
    context.provider.logs = [opened];
    const replayed = await syncTradeHistoryV2PipelineRange({
      previous: initial.state,
      scope: {
        chainId: CHAIN_ID.toString(), contractAddress: CONTRACT,
        deploymentBlock: DEPLOYMENT_BLOCK.toString()
      },
      capability: context.capability,
      deployment: context.deployment,
      confirmationDepth: FINALITY_LAG,
      maxBlockSpan: 21n,
      overlapBlocks: 1n,
      reads: pipelineReads(context.provider),
      expectedLedgerRevision: 1,
      expectedMaterializationRevision: 1
    });
    expect(replayed.reorged).toBe(true);
    expect(projectTradeHistoryV2Rows({ state: replayed.state.sync.ledger, viewerAddress: MAKER })).toEqual([]);
    expect(Object.values(replayed.state.materialization.directOpeningsByOrderKey)).toMatchObject([{
      orderId: '8',
      publicAmounts: { offerAmount: '10', requestAmount: '20' }
    }]);
  });

  it('replaces stale participant-private Direct amounts when a deep fork reassigns the trade', async () => {
    const context = await setup('direct-v2');
    const scope = {
      chainId: CHAIN_ID.toString(), contractAddress: CONTRACT,
      deploymentBlock: DEPLOYMENT_BLOCK.toString()
    };
    const originalOpened = context.provider.addLog({
      eventName: 'DirectTradeOpened',
      args: [9n, MAKER, FILLER, ZERO_ADDRESS, 0n, 9n, 0, 2, OTHER_CONTRACT, 2, CONTRACT, 1, 0n, 0n, 1n, 999999n],
      blockNumber: 110n,
      transactionHash: hash('c9'),
      logIndex: 1
    });
    const originalAccepted = context.provider.addLog({
      eventName: 'DirectTradeStatusChanged',
      args: [9n, MAKER, FILLER, 1, 2, FILLER, 9n, 1_700_000_009n],
      blockNumber: 120n,
      transactionHash: hash('d9'),
      logIndex: 1
    });
    context.provider.logs = [originalOpened, originalAccepted];
    const initial = await syncTradeHistoryV2PipelineRange({
      previous: {
        sync: createTradeHistoryV2SyncState(createTradeHistoryV2LedgerState()),
        materialization: createTradeHistoryV2MaterializationState()
      },
      scope,
      capability: context.capability,
      deployment: context.deployment,
      confirmationDepth: FINALITY_LAG,
      maxBlockSpan: 21n,
      overlapBlocks: 1n,
      reads: pipelineReads(context.provider),
      expectedLedgerRevision: 0,
      expectedMaterializationRevision: 0,
      viewer: MAKER,
      resolveDirectPrivateAmounts: async () => ({ offerAmount: '55', requestAmount: '89' })
    });
    expect(projectTradeHistoryV2Rows({
      state: initial.state.sync.ledger,
      viewerAddress: MAKER
    })).toMatchObject([{
      source: 'participant-receipt',
      amounts: { offerAmount: '55', requestAmount: '89' }
    }]);

    context.provider.blocks.set('110', { hash: blockHash(110n, 9n), transactions: [] });
    context.provider.blocks.set('120', { hash: blockHash(120n, 9n), transactions: [] });
    const canonicalOpened = context.provider.addLog({
      eventName: 'DirectTradeOpened',
      args: [9n, MAKER, FILLER, ZERO_ADDRESS, 0n, 9n, 0, 2, OTHER_CONTRACT, 2, CONTRACT, 1, 0n, 0n, 1n, 999999n],
      blockNumber: 110n,
      transactionHash: hash('e9'),
      logIndex: 1,
      hashSuffix: 9n
    });
    const canonicalAccepted = context.provider.addLog({
      eventName: 'DirectTradeStatusChanged',
      args: [9n, MAKER, FILLER, 1, 2, FILLER, 9n, 1_700_000_109n],
      blockNumber: 120n,
      transactionHash: hash('f9'),
      logIndex: 1,
      hashSuffix: 9n
    });
    context.provider.logs = [canonicalOpened, canonicalAccepted];
    const replayed = await syncTradeHistoryV2PipelineRange({
      previous: initial.state,
      scope,
      capability: context.capability,
      deployment: context.deployment,
      confirmationDepth: FINALITY_LAG,
      maxBlockSpan: 21n,
      overlapBlocks: 1n,
      reads: pipelineReads(context.provider),
      expectedLedgerRevision: 1,
      expectedMaterializationRevision: 1,
      viewer: MAKER,
      resolveDirectPrivateAmounts: async () => ({ offerAmount: '34', requestAmount: '55' })
    });
    const rows = projectTradeHistoryV2Rows({
      state: replayed.state.sync.ledger,
      viewerAddress: MAKER
    });
    expect(replayed.reorged).toBe(true);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      source: 'participant-receipt',
      amounts: { offerAmount: '34', requestAmount: '55' },
      log: { blockHash: blockHash(120n, 9n), transactionHash: hash('f9') }
    });
    expect(JSON.stringify(rows)).not.toContain('89');
  });

  it('rejects a finality-policy mismatch before any pipeline reads', async () => {
    const context = await setup('standard-v2');
    const reads = pipelineReads(context.provider);
    const latest = vi.spyOn(reads, 'getLatestBlockNumber');
    await expect(syncTradeHistoryV2PipelineRange({
      previous: {
        sync: createTradeHistoryV2SyncState(createTradeHistoryV2LedgerState()),
        materialization: createTradeHistoryV2MaterializationState()
      },
      scope: {
        chainId: CHAIN_ID.toString(), contractAddress: CONTRACT,
        deploymentBlock: DEPLOYMENT_BLOCK.toString()
      },
      capability: context.capability,
      deployment: context.deployment,
      confirmationDepth: FINALITY_LAG + 1n,
      maxBlockSpan: 21n,
      overlapBlocks: 1n,
      reads,
      expectedLedgerRevision: 0,
      expectedMaterializationRevision: 0
    })).rejects.toThrow(/finality differs/);
    expect(latest).not.toHaveBeenCalled();
  });
});
