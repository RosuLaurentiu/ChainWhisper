import { Interface, keccak256, toUtf8Bytes, type Eip1193Provider } from '@coti-io/coti-ethers';
import { describe, expect, it } from 'vitest';
import {
  attestPrivateLiquidityDeployment,
  bindPrivateLiquidityReadCapability,
  readCanonicalPrivateLiquidityLogRange,
  type CanonicalPrivateLiquidityLogRange
} from './privateLiquidityChain';
import { PRIVATE_LIQUIDITY_V1_EVENT_ABI } from './privateLiquidityEvents';
import { materializeCanonicalPrivateLiquidityHistory } from './privateLiquidityHistoryMaterialize';
import { packSelfCheckingPrivateLiquidityAmountForTest } from './privateLiquidityReceipt';

const address = (pair: string): string => `0x${pair.repeat(20)}`;
const hash = (pair: string): string => `0x${pair.repeat(32)}`;
const quantity = (value: bigint | number): string => `0x${BigInt(value).toString(16)}`;
const blockHash = (number: bigint): string => `0x${number.toString(16).padStart(64, '0')}`;

const CHAIN_ID = 7_082_400n;
const CONTRACT = address('11');
const VIEWER = address('22');
const PAIR = hash('33');
const CODE = '0x6001600055';
const EVENTS = new Interface(PRIVATE_LIQUIDITY_V1_EVENT_ABI);
const METADATA = new Interface([
  'function contractVersion() view returns (string)',
  'function supportsFeature(bytes32 feature) view returns (bool)'
]);
const TX_HASH = hash('aa');
const APP_WALLET_FEATURE = keccak256(toUtf8Bytes('APP_WALLET_EXECUTOR')).toLowerCase();

const encrypted = (authenticated: bigint, user: bigint) => [
  [authenticated, authenticated + 1n],
  [user, user + 1n]
];

class HistoryProvider implements Pick<Eip1193Provider, 'request'> {
  latest = 130n;
  logs: Record<string, unknown>[];
  receipt: Record<string, unknown>;

  constructor() {
    const event = (name: string, args: readonly unknown[], logIndex: bigint) => {
      const fragment = EVENTS.getEvent(name);
      if (!fragment) throw new Error(`Missing ${name}.`);
      const encoded = EVENTS.encodeEventLog(fragment, [...args]);
      return {
        address: CONTRACT,
        topics: encoded.topics,
        data: encoded.data,
        blockNumber: quantity(120n),
        blockHash: blockHash(120n),
        transactionHash: TX_HASH,
        transactionIndex: quantity(0n),
        logIndex: quantity(logIndex),
        removed: false
      };
    };
    this.logs = [
      event('PrivateLiquidityPositionExecutionReceiptUpdated', [
        7n,
        5n,
        VIEWER,
        0,
        encrypted(10n, 100n),
        encrypted(20n, 200n)
      ], 1n),
      event('PrivateLiquidityTraderSwapReceiptUpdated', [
        5n,
        VIEWER,
        PAIR,
        0,
        encrypted(30n, 300n),
        encrypted(40n, 400n),
        encrypted(50n, 500n)
      ], 2n),
      event('PrivateLiquiditySwapExecuted', [5n, VIEWER, PAIR, 0, 1n], 3n)
    ];
    this.receipt = {
      status: quantity(1n),
      blockNumber: quantity(120n),
      blockHash: blockHash(120n),
      transactionHash: TX_HASH,
      transactionIndex: quantity(0n),
      logs: this.logs.map((log) => ({ ...log, removed: undefined }))
    };
  }

  async request({ method, params = [] }: { method: string; params?: readonly unknown[] }): Promise<unknown> {
    if (method === 'eth_chainId') return quantity(CHAIN_ID);
    if (method === 'eth_blockNumber') return quantity(this.latest);
    if (method === 'eth_getBlockByNumber') {
      const number = BigInt(String(params[0]));
      return {
        number: quantity(number),
        hash: blockHash(number),
        transactions: number === 120n ? [TX_HASH] : []
      };
    }
    if (method === 'eth_getCode') return CODE;
    if (method === 'eth_getLogs') {
      const filter = params[0] as { topics?: unknown[] };
      const requested = Array.isArray(filter?.topics?.[0])
        ? new Set((filter.topics[0] as unknown[]).map((topic) => String(topic).toLowerCase()))
        : new Set<string>();
      return this.logs.filter((log) => requested.has(String(
        (log as { topics?: unknown[] }).topics?.[0]
      ).toLowerCase()));
    }
    if (method === 'eth_getTransactionReceipt') return this.receipt;
    if (method === 'eth_call') {
      const call = params[0] as { data: string };
      const parsed = METADATA.parseTransaction({ data: call.data });
      if (!parsed) throw new Error('Unknown metadata call.');
      return parsed.name === 'contractVersion'
        ? METADATA.encodeFunctionResult(parsed.name, ['ChainWhisperPrivateLiquidityBookV1'])
        : METADATA.encodeFunctionResult(parsed.name, [
            String(parsed.args[0]).toLowerCase() !== APP_WALLET_FEATURE
          ]);
    }
    throw new Error(`Unexpected RPC ${method}.`);
  }
}

const canonicalPage = async () => {
  const provider = new HistoryProvider();
  const capability = await bindPrivateLiquidityReadCapability({
    provider,
    expectedChainId: CHAIN_ID,
    assertCurrent: () => undefined
  });
  const deployment = await attestPrivateLiquidityDeployment({
    capability,
    manifest: {
      chainId: CHAIN_ID,
      contractAddress: CONTRACT,
      deploymentBlock: 100n,
      runtimeBytecodeHash: keccak256(CODE)
    },
    finalityLagBlocks: 5n
  });
  const page = await readCanonicalPrivateLiquidityLogRange({
    capability,
    deployment,
    fromBlock: 100n,
    toBlock: 125n
  });
  return { provider, capability, deployment, page };
};

const decrypt = async ({ ciphertextHigh }: { ciphertextHigh: bigint }) => {
  if (ciphertextHigh === 100n || ciphertextHigh === 300n) {
    return packSelfCheckingPrivateLiquidityAmountForTest(10n);
  }
  if (ciphertextHigh === 200n || ciphertextHigh === 400n) {
    return packSelfCheckingPrivateLiquidityAmountForTest(90n);
  }
  if (ciphertextHigh === 500n) return packSelfCheckingPrivateLiquidityAmountForTest(5n);
  throw new Error('Unexpected ciphertext.');
};

describe('privateLiquidityHistoryMaterialize', () => {
  it('decrypts only canonical viewer receipts into exact trader and per-position history', async () => {
    const { page } = await canonicalPage();
    const snapshot = await materializeCanonicalPrivateLiquidityHistory({
      pages: [page],
      viewer: VIEWER,
      decrypt
    });
    expect(snapshot.coverage).toEqual({
      fromBlock: '100',
      toBlock: '125',
      safeHead: '125',
      completeFromDeploymentThroughSafeHead: true,
      hasRangeGaps: false
    });
    expect(snapshot.history.traderRows).toHaveLength(1);
    expect(snapshot.history.traderRows[0]).toMatchObject({
      swapId: '5',
      inputAmount: '10',
      outputAmount: '90',
      unusedInputAmount: '5',
      candidateCount: 1
    });
    expect(snapshot.history.positionRows[0]).toMatchObject({
      positionId: '7',
      baseAmount: '10',
      quoteAmount: '90'
    });
    expect(snapshot.history.positionTotals[0]).toMatchObject({
      fillCount: 1,
      baseReceived: '10',
      quotePaid: '90'
    });
  });

  it('deduplicates an exact canonical overlap without doubling totals', async () => {
    const context = await canonicalPage();
    const repeated = await readCanonicalPrivateLiquidityLogRange({
      capability: context.capability,
      deployment: context.deployment,
      fromBlock: 100n,
      toBlock: 125n
    });
    const snapshot = await materializeCanonicalPrivateLiquidityHistory({
      pages: [context.page, repeated],
      viewer: VIEWER,
      decrypt
    });
    expect(snapshot.history.traderRows).toHaveLength(1);
    expect(snapshot.history.positionRows).toHaveLength(1);
  });

  it('fails closed on wrong privacy state instead of rendering a plausible amount', async () => {
    const { page } = await canonicalPage();
    await expect(materializeCanonicalPrivateLiquidityHistory({
      pages: [page],
      viewer: VIEWER,
      decrypt: async () => 10n << 128n
    })).rejects.toThrow(/failed its self-check/);
  });

  it('rejects structurally forged pages before decrypting anything', async () => {
    const { page } = await canonicalPage();
    await expect(materializeCanonicalPrivateLiquidityHistory({
      pages: [{ ...page } as CanonicalPrivateLiquidityLogRange],
      viewer: VIEWER,
      decrypt
    })).rejects.toThrow(/provider-owned canonical page/);
  });
});
