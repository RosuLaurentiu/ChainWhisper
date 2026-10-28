import { Interface, keccak256, toUtf8Bytes, type Eip1193Provider } from '@coti-io/coti-ethers';
import { describe, expect, it } from 'vitest';
import { parseTradeOfferMessagePayload, parseTradeResponseMessagePayload } from './appShared/tradeMessages';
import { projectCanonicalDirectTradeV2ChatEntries } from './directTradeV2ChatProjection';
import {
  attestTradeHistoryV2Deployment,
  bindTradeHistoryV2ReadCapability,
  readCanonicalTradeHistoryV2LogRange
} from './tradeHistoryV2Chain';
import { TRADE_HISTORY_V2_EVENT_ABIS } from './tradeHistoryV2Events';

const address = (pair: string): string => `0x${pair.repeat(20)}`;
const hash = (pair: string): string => `0x${pair.repeat(32)}`;
const blockHash = (number: bigint): string => `0x${number.toString(16).padStart(64, '0')}`;
const quantity = (value: bigint): string => `0x${value.toString(16)}`;

const CHAIN_ID = 7_082_400n;
const CONTRACT = address('11');
const MAKER = address('22');
const TAKER = address('33');
const ZERO = address('00');
const CODE = '0x6001600055';
const DIRECT = new Interface(TRADE_HISTORY_V2_EVENT_ABIS.direct);
const METADATA = new Interface([
  'function contractVersion() view returns (string)',
  'function supportsFeature(bytes32 feature) view returns (bool)'
]);
const APP_WALLET_FEATURE = keccak256(toUtf8Bytes('APP_WALLET_EXECUTOR')).toLowerCase();

type RawLog = Readonly<Record<string, unknown>>;

class DirectProvider implements Pick<Eip1193Provider, 'request'> {
  readonly latest = 150n;
  readonly blocks = new Map<string, { hash: string; transactions: string[] }>();
  readonly receipts = new Map<string, Record<string, unknown>>();
  logs: RawLog[] = [];

  async request({ method, params = [] }: { method: string; params?: readonly unknown[] }): Promise<unknown> {
    if (method === 'eth_chainId') return quantity(CHAIN_ID);
    if (method === 'eth_blockNumber') return quantity(this.latest);
    if (method === 'eth_getCode') return CODE;
    if (method === 'eth_getLogs') return [...this.logs];
    if (method === 'eth_getTransactionReceipt') {
      return this.receipts.get(String(params[0]).toLowerCase()) ?? null;
    }
    if (method === 'eth_getBlockByNumber') {
      const number = BigInt(String(params[0]));
      const block = this.blocks.get(number.toString()) ?? { hash: blockHash(number), transactions: [] };
      return { number: quantity(number), hash: block.hash, transactions: [...block.transactions] };
    }
    if (method === 'eth_call') {
      const call = params[0] as { data: string };
      const parsed = METADATA.parseTransaction({ data: call.data });
      if (!parsed) throw new Error('Unknown metadata call.');
      if (parsed.name === 'contractVersion') {
        return METADATA.encodeFunctionResult(parsed.name, ['ChainWhisperDirectOTCEscrowV2']);
      }
      return METADATA.encodeFunctionResult(parsed.name, [
        String(parsed.args[0]).toLowerCase() !== APP_WALLET_FEATURE
      ]);
    }
    throw new Error(`Unexpected RPC method ${method}.`);
  }

  addLog({
    blockNumber,
    transactionHash,
    eventName,
    args
  }: {
    blockNumber: bigint;
    transactionHash: string;
    eventName: 'DirectTradeOpened' | 'DirectTradeStatusChanged';
    args: readonly unknown[];
  }): void {
    const event = DIRECT.getEvent(eventName);
    if (!event) throw new Error(`Missing ${eventName} ABI.`);
    const encoded = DIRECT.encodeEventLog(event, [...args]);
    const block = this.blocks.get(blockNumber.toString()) ?? {
      hash: blockHash(blockNumber),
      transactions: []
    };
    const transactionIndex = block.transactions.length;
    block.transactions.push(transactionHash);
    this.blocks.set(blockNumber.toString(), block);
    const raw = {
      address: CONTRACT,
      topics: encoded.topics,
      data: encoded.data,
      blockNumber: quantity(blockNumber),
      blockHash: block.hash,
      transactionHash,
      transactionIndex: quantity(BigInt(transactionIndex)),
      logIndex: '0x0',
      removed: false
    };
    this.logs.push(raw);
    this.receipts.set(transactionHash.toLowerCase(), {
      status: '0x1',
      blockNumber: quantity(blockNumber),
      blockHash: block.hash,
      transactionHash,
      transactionIndex: quantity(BigInt(transactionIndex)),
      logs: [{ ...raw, removed: undefined }]
    });
  }
}

const canonicalPage = async () => {
  const provider = new DirectProvider();
  provider.addLog({
    blockNumber: 120n,
    transactionHash: hash('aa'),
    eventName: 'DirectTradeOpened',
    args: [
      7n,
      MAKER,
      TAKER,
      ZERO,
      0n,
      7n,
      0n,
      0n,
      ZERO,
      1n,
      address('44'),
      0n,
      10n,
      25n,
      1_700_000_000n,
      1_700_003_600n
    ]
  });
  provider.addLog({
    blockNumber: 121n,
    transactionHash: hash('bb'),
    eventName: 'DirectTradeStatusChanged',
    args: [7n, MAKER, TAKER, 1n, 2n, TAKER, 7n, 1_700_000_100n]
  });
  const capability = await bindTradeHistoryV2ReadCapability({
    provider,
    expectedChainId: CHAIN_ID,
    assertCurrent: () => undefined
  });
  const deployment = await attestTradeHistoryV2Deployment({
    capability,
    manifest: {
      protocol: 'direct-v2',
      chainId: CHAIN_ID,
      contractAddress: CONTRACT,
      deploymentBlock: 100n,
      runtimeBytecodeHash: keccak256(CODE)
    },
    finalityLagBlocks: 5n
  });
  return readCanonicalTradeHistoryV2LogRange({
    capability,
    deployment,
    fromBlock: 120n,
    toBlock: 121n
  });
};

describe('directTradeV2ChatProjection', () => {
  it('projects finalized escrow events into one offer card and one status update without a chat write', async () => {
    const entries = projectCanonicalDirectTradeV2ChatEntries({
      page: await canonicalPage(),
      viewerAddress: TAKER
    });
    expect(entries).toHaveLength(2);
    expect(entries.every(({ contact }) => contact === MAKER)).toBe(true);

    const offer = parseTradeOfferMessagePayload(entries[0].message.text);
    expect(offer).toMatchObject({
      version: 2,
      tradeId: 7,
      escrowContract: CONTRACT,
      maker: MAKER,
      taker: TAKER,
      createdAt: 1_700_000_000,
      expiresAt: 1_700_003_600
    });
    expect(entries[0].message).toMatchObject({
      direction: 'incoming',
      isSystem: true,
      txHash: hash('aa'),
      directTradeV2: { eventKind: 'opened', finality: 'finalized' }
    });

    const response = parseTradeResponseMessagePayload(entries[1].message.text);
    expect(response).toMatchObject({
      version: 2,
      tradeId: 7,
      action: 'accepted',
      actor: TAKER,
      relatedTradeId: 7
    });
    expect(entries[1].message).toMatchObject({
      direction: 'outgoing',
      isSystem: true,
      txHash: hash('bb'),
      directTradeV2: { eventKind: 'status', finality: 'finalized' }
    });
  });

  it('does not project another wallet\'s direct trade', async () => {
    expect(projectCanonicalDirectTradeV2ChatEntries({
      page: await canonicalPage(),
      viewerAddress: address('99')
    })).toEqual([]);
  });

  it('rejects a structural page that was not provider-attested', () => {
    expect(() => projectCanonicalDirectTradeV2ChatEntries({
      page: { scope: { protocol: 'direct-v2' } } as never,
      viewerAddress: TAKER
    })).toThrow(/not a provider-owned canonical page/i);
  });
});
