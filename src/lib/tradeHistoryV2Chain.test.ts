import { Interface, keccak256, toUtf8Bytes, type Eip1193Provider } from '@coti-io/coti-ethers';
import { describe, expect, it, vi } from 'vitest';
import {
  attestTradeHistoryV2Deployment,
  attestTradeHistoryV2Deployments,
  assertCanonicalTradeHistoryV2LogRange,
  bindTradeHistoryV2ReadCapability,
  readAttestedTradeHistoryV2View,
  readCanonicalTradeHistoryV2LogRange,
  readCanonicalTradeV2RawLogRange,
  type AttestedTradeHistoryV2Deployment,
  type TradeHistoryV2ManifestInput,
  type TradeHistoryV2ReadCapability
} from './tradeHistoryV2Chain';
import { TRADE_HISTORY_V2_EVENT_ABIS, PRIVATE_BOOK_V2_HISTORY_RUNTIME_HASH } from './tradeHistoryV2Events';
import { LINK_TRADE_V2_ABI } from './linkTradeV2Abi';
import currentArtifact from '../../tests/fixtures/validation-ChainWhisperPrivateOTCEscrowV2.json';
import { createTradeHistoryV2MaterializationState, materializeCanonicalTradeHistoryV2Range } from './tradeHistoryV2Materialize';
import { createTradeHistoryV2LedgerState, getTradeHistoryV2LedgerRevision, projectTradeHistoryV2Rows } from './tradeHistoryV2Ledger';
import { getTradeHistoryV2MaterializationRevision } from './tradeHistoryV2Materialize';
import { createTradeHistoryV2SyncState } from './tradeHistoryV2Sync';
import { syncTradeHistoryV2PipelineRange } from './tradeHistoryV2Pipeline';
import { readTradeHistoryV2CanonicalBlock, readTradeHistoryV2LatestBlockNumber } from './tradeHistoryV2Chain';
import { createOtcTradeHistoryV2Runtime } from './otcTradeHistoryV2Runtime';

const address = (pair: string): string => `0x${pair.repeat(20)}`;
const hash = (pair: string): string => `0x${pair.repeat(32)}`;
const quantity = (value: bigint | number): string => `0x${BigInt(value).toString(16)}`;
const blockHash = (number: bigint): string => `0x${number.toString(16).padStart(64, '0')}`;

const CHAIN_ID = 7_082_400n;

describe('trade-history safe RPC failure labels', () => {
  it('shows only numeric queue timing and drops private error fields', async () => {
    const request = vi.fn().mockRejectedValue(Object.assign(new Error('COTI RPC read expired in queue.'), {
      code: 'COTI_RPC_QUEUE_EXPIRED',
      queueTiming: { ahead: 64, completed: 60, waitedMs: 29_500, budgetMs: 30_000,
        transportMs: 1_200, pacingMs: 28_300, nextStartMs: 500, privateValue: 'private-request-value' },
      request: { data: 'private-request-value' }, response: { body: 'private-response-value' }
    }));
    const result = bindTradeHistoryV2ReadCapability({
      provider: { request }, expectedChainId: CHAIN_ID, assertCurrent: () => undefined
    }).catch((error: Error) => error.message);
    expect(await result).toBe('Trade-history RPC eth_chainId failed (request expired in queue; 29500/30000ms elapsed; 64 ahead, 60 completed; 1200ms transport, 28300ms pacing, 500ms next start).');
    expect(request).toHaveBeenCalledOnce();
  });

  it('does not format untrusted or invalid queue timing as text', async () => {
    const request = vi.fn().mockRejectedValue(Object.assign(new Error('COTI RPC read expired in queue.'), {
      code: 'COTI_RPC_QUEUE_EXPIRED',
      queueTiming: { ahead: 'private-request-value', completed: 1, waitedMs: 1, budgetMs: 1,
        transportMs: 1, pacingMs: 0, nextStartMs: 0 }
    }));
    const result = bindTradeHistoryV2ReadCapability({
      provider: { request }, expectedChainId: CHAIN_ID, assertCurrent: () => undefined
    }).catch((error: Error) => error.message);
    expect(await result).toBe('Trade-history RPC eth_chainId failed (request expired in queue).');
  });

  it.each([
    { label: 'timeout', cause: Object.assign(new Error('private-request-value'), { code: 'TIMEOUT' }), detail: 'request timed out' },
    { label: 'network', cause: Object.assign(new Error('private-request-value'), { code: 'NETWORK_ERROR' }), detail: 'network error' },
    { label: 'queue expiry', cause: new Error('COTI RPC read expired in queue.'), detail: 'request expired in queue' },
    { label: '403 stop', cause: new Error('COTI RPC reads stopped after HTTP 403. No automatic retry.'), detail: 'HTTP 403; reads stopped' },
    { label: '429 stop', cause: new Error('COTI RPC reads stopped after HTTP 429. No automatic retry.'), detail: 'HTTP 429; reads stopped' },
    { label: 'unknown private error', cause: new Error('private-request-value'), detail: '' }
  ])('keeps the safe $label category without exposing request data or retrying', async ({ cause, detail }) => {
    const request = vi.fn().mockRejectedValue(Object.assign(cause, {
      request: { data: 'private-request-value' }, response: { body: 'private-response-value' }
    }));
    const result = bindTradeHistoryV2ReadCapability({
      provider: { request }, expectedChainId: CHAIN_ID, assertCurrent: () => undefined
    }).catch((error: Error) => error.message);
    expect(await result).toBe(`Trade-history RPC eth_chainId failed${detail ? ` (${detail})` : ''}.`);
    expect(request).toHaveBeenCalledExactlyOnceWith({ method: 'eth_chainId', params: [] });
  });
});

const CONTRACT = address('11');
const MAKER = address('22');
const FILLER = address('33');
const CODE = '0x6001600055';
const DEPLOYMENT_BLOCK = 100n;
const LATEST = 150n;
const LAG = 5n;
const SAFE_HEAD = LATEST - LAG;
const METADATA = new Interface([
  'function contractVersion() view returns (string)',
  'function supportsFeature(bytes32 feature) view returns (bool)'
]);
const STANDARD = new Interface(TRADE_HISTORY_V2_EVENT_ABIS.standard);
const APP_WALLET_FEATURE = keccak256(toUtf8Bytes('APP_WALLET_EXECUTOR')).toLowerCase();

const MANIFEST: TradeHistoryV2ManifestInput = {
  protocol: 'standard-v2',
  chainId: CHAIN_ID,
  contractAddress: CONTRACT,
  deploymentBlock: DEPLOYMENT_BLOCK,
  runtimeBytecodeHash: keccak256(CODE)
};

type RpcCall = Readonly<{ method: string; params: readonly unknown[] }>;

class ScriptedProvider implements Pick<Eip1193Provider, 'request'> {
  chainId = CHAIN_ID;
  latest = LATEST;
  code = CODE;
  version = 'ChainWhisperStandardOTCEscrowV2';
  versions = new Map<string, string>();
  appWalletExecutor = false;
  unsupportedFeatures = new Set<string>();
  logs: unknown[] = [];
  blocks = new Map<string, { hash: string; transactions: string[] }>();
  receipts = new Map<string, Record<string, unknown>>();
  calls: RpcCall[] = [];
  reorgAttestation = false;
  private attestationReads = 0;

  private block(number: bigint) {
    const configured = this.blocks.get(number.toString()) ?? {
      hash: blockHash(number),
      transactions: []
    };
    let canonicalHash = configured.hash;
    if (this.reorgAttestation && number === SAFE_HEAD) {
      this.attestationReads += 1;
      if (this.attestationReads > 1) canonicalHash = hash('fe');
    }
    return {
      number: quantity(number),
      hash: canonicalHash,
      transactions: [...configured.transactions]
    };
  }

  async request({ method, params = [] }: { method: string; params?: readonly unknown[] }): Promise<unknown> {
    this.calls.push({ method, params: [...params] });
    if (method === 'eth_chainId') return quantity(this.chainId);
    if (method === 'eth_blockNumber') return quantity(this.latest);
    if (method === 'eth_getBlockByNumber') return this.block(BigInt(String(params[0])));
    if (method === 'eth_getCode') return this.code;
    if (method === 'eth_getLogs') return [...this.logs];
    if (method === 'eth_getTransactionReceipt') {
      return this.receipts.get(String(params[0]).toLowerCase()) ?? null;
    }
    if (method === 'eth_call') {
      const call = params[0] as { data: string; to: string };
      const parsed = METADATA.parseTransaction({ data: call.data });
      if (!parsed) throw new Error('Unknown metadata call.');
      if (parsed.name === 'contractVersion') {
        return METADATA.encodeFunctionResult(parsed.name, [this.versions.get(call.to) ?? this.version]);
      }
      const feature = String(parsed.args[0]).toLowerCase();
      const supported = feature === APP_WALLET_FEATURE
        ? this.appWalletExecutor
        : !this.unsupportedFeatures.has(feature);
      return METADATA.encodeFunctionResult(parsed.name, [supported]);
    }
    throw new Error(`Unexpected RPC method ${method}.`);
  }
}

const bind = async (
  provider: ScriptedProvider,
  assertCurrent: () => void | Promise<void> = vi.fn(async () => undefined)
): Promise<TradeHistoryV2ReadCapability> => bindTradeHistoryV2ReadCapability({
  provider,
  expectedChainId: CHAIN_ID,
  assertCurrent
});

const attest = async (provider = new ScriptedProvider()): Promise<{
  provider: ScriptedProvider;
  capability: TradeHistoryV2ReadCapability;
  deployment: AttestedTradeHistoryV2Deployment;
}> => {
  const capability = await bind(provider);
  const deployment = await attestTradeHistoryV2Deployment({
    capability,
    manifest: MANIFEST,
    finalityLagBlocks: LAG
  });
  return { provider, capability, deployment };
};

describe('P2P startup attestation', () => {
  const setup = () => {
    const provider = new ScriptedProvider();
    const protocols = ['standard-v2', 'private-v2', 'direct-v2', 'recurring-v2', 'private-recurring-v2'] as const;
    const versions = ['ChainWhisperStandardOTCEscrowV2', 'ChainWhisperPrivateOTCEscrowV2', 'ChainWhisperDirectOTCEscrowV2',
      'ChainWhisperRecurringOTCEscrowV2', 'ChainWhisperPrivateRecurringOTCEscrowV2'];
    const descriptor = (protocol: typeof protocols[number], index: number) => {
      const contractAddress = address((32 + index).toString(16));
      provider.versions.set(contractAddress, versions[protocols.indexOf(protocol)]);
      return { protocol, manifest: { ...MANIFEST, protocol, contractAddress } };
    };
    const deployments = Object.fromEntries(protocols.map((protocol, index) => [protocol, descriptor(protocol, index)]));
    const retainedDeployments = Object.fromEntries(protocols.slice(0, 3).map((protocol, index) => [protocol, descriptor(protocol, index + 5)]));
    const catalog = { status: 'active', chainId: CHAIN_ID.toString(), deployments, finalityLagBlocks: LAG,
      preparedP2p: { status: 'book-admitted', retainedDeployments } };
    return { provider, create: (assertCurrent = () => {}) => createOtcTradeHistoryV2Runtime({
      catalog: catalog as never, provider, ownerAddress: MAKER, assertCurrent
    }) };
  };

  it('uses one canonical setup boundary for eight current and retained contracts', async () => {
    const { provider, create } = setup();
    const runtime = await create();
    expect(runtime.retainedDeployments).toHaveLength(3);
    expect(provider.calls).toHaveLength(71);
    expect(provider.calls.filter(call => call.method === 'eth_blockNumber')).toHaveLength(1);
    expect(provider.calls.filter(call => call.method === 'eth_getBlockByNumber')).toHaveLength(2);
    expect(provider.calls.filter(call => call.method === 'eth_chainId')).toHaveLength(4);
    expect(provider.calls.filter(call => call.method === 'eth_getCode')).toHaveLength(8);
    expect(provider.calls.filter(call => call.method === 'eth_call')).toHaveLength(56);
    for (const call of provider.calls.filter(call => ['eth_getCode', 'eth_call'].includes(call.method))) {
      expect(call.params[1]).toEqual({ blockHash: blockHash(SAFE_HEAD), requireCanonical: true });
    }
    const deployments = [...Object.values(runtime.deployments), ...runtime.retainedDeployments!];
    expect(deployments.every(item => item.attestationBlock.hash === blockHash(SAFE_HEAD))).toBe(true);
    runtime.close();
  });

  it('rejects a reorg before exposing the setup result', async () => {
    const { provider, create } = setup();
    provider.reorgAttestation = true;
    await expect(create()).rejects.toThrow(/reorganized/);
  });

  it.each(['code', 'version', 'feature', 'app-wallet', 'chain', 'lease'] as const)('rejects a %s failure late in setup', async failure => {
    const { provider, create } = setup();
    const request = provider.request.bind(provider);
    let revoked = false, reachedRetained = false;
    provider.request = async args => {
      const result = await request(args);
      if ((args.method === 'eth_getCode' && args.params?.[0] === address('27')) ||
          (args.method === 'eth_call' && (args.params?.[0] as { to: string }).to === address('27'))) reachedRetained = true;
      if (!reachedRetained) return result;
      if (failure === 'code' && args.method === 'eth_getCode') return '0x6002';
      if (failure === 'chain' && args.method === 'eth_chainId') return '0x1';
      if (failure === 'lease') revoked = true;
      if (args.method === 'eth_call') {
        const call = METADATA.parseTransaction({ data: (args.params![0] as { data: string }).data })!;
        if (failure === 'version' && call.name === 'contractVersion') return METADATA.encodeFunctionResult(call.name, ['wrong']);
        if (call.name === 'supportsFeature') {
          const executor = String(call.args[0]).toLowerCase() === APP_WALLET_FEATURE;
          if (failure === 'feature' && !executor) return METADATA.encodeFunctionResult(call.name, [false]);
          if (failure === 'app-wallet' && executor) return METADATA.encodeFunctionResult(call.name, [true]);
        }
      }
      return result;
    };
    await expect(create(() => { if (revoked) throw new Error('Session revoked.'); })).rejects.toThrow();
  });
});

describe('Link V2 canonical deployment boundary', () => {
  it('measures common-snapshot admission savings without removing contract checks', async () => {
    const protocols = [
      ['standard-v2', 'ChainWhisperStandardOTCEscrowV2'],
      ['private-v2', 'ChainWhisperPrivateOTCEscrowV2'],
      ['direct-v2', 'ChainWhisperDirectOTCEscrowV2'],
      ['link-v2', 'ChainWhisperLinkOTCEscrowV2'],
      ['counter-v2', 'ChainWhisperCounterOTCEscrowV2']
    ] as const;
    for (const selected of [protocols.slice(3), protocols]) {
      const manifests = selected.map(([protocol], index) => ({ ...MANIFEST, protocol, contractAddress: address(String(40 + index)) }));
      const measure = async (batch: boolean) => {
        const provider = new ScriptedProvider();
        selected.forEach(([, version], index) => provider.versions.set(manifests[index].contractAddress, version));
        const capability = await bind(provider);
        provider.calls = [];
        const deployments = batch
          ? await attestTradeHistoryV2Deployments({ capability, manifests, finalityLagBlocks: LAG })
          : await Promise.all(manifests.map(manifest => attestTradeHistoryV2Deployment({ capability, manifest, finalityLagBlocks: LAG })));
        return { provider, deployments };
      };
      const single = await measure(false), batch = await measure(true);
      expect(batch.deployments).toEqual(single.deployments);
      const metadata = (provider: ScriptedProvider) => provider.calls
        .filter(call => call.method === 'eth_call' || call.method === 'eth_getCode')
        .map(call => JSON.stringify(call)).sort();
      expect(metadata(batch.provider)).toEqual(metadata(single.provider));
      expect(single.provider.calls.length - batch.provider.calls.length).toBe(6 * (manifests.length - 1));
      expect(batch.provider.calls.filter(call => call.method === 'eth_blockNumber')).toHaveLength(1);
      expect(batch.provider.calls.filter(call => call.method === 'eth_getBlockByNumber')).toHaveLength(2);
      console.info(JSON.stringify({ admissionContracts: manifests.length,
        separateRequests: single.provider.calls.length, commonSnapshotRequests: batch.provider.calls.length }));
    }
  });
  it.each([['link-v2', 'ChainWhisperLinkOTCEscrowV2'], ['counter-v2', 'ChainWhisperCounterOTCEscrowV2']] as const)('attests exact %s runtime/version without requiring absent feature getters', async (protocol, version) => {
    const provider = new ScriptedProvider();
    provider.version = version;
    const capability = await bind(provider);
    const deployment = await attestTradeHistoryV2Deployment({ capability,
      manifest: { ...MANIFEST, protocol }, finalityLagBlocks: LAG });
    expect(deployment.protocol).toBe(protocol);
    const calls = provider.calls.filter(call => call.method === 'eth_call');
    expect(calls).toHaveLength(1);
    expect(METADATA.parseTransaction({ data: (calls[0].params[0] as { data: string }).data })?.name)
      .toBe('contractVersion');
    await expect(readAttestedTradeHistoryV2View({ capability, deployment,
      data: METADATA.encodeFunctionData('contractVersion'), from: MAKER })).resolves
      .toBe(METADATA.encodeFunctionResult('contractVersion', [version]));
    const view = provider.calls.filter(call => call.method === 'eth_call').slice(-1)[0];
    expect((view.params[0] as { from: string }).from).toBe(MAKER);
    provider.code = '0x6002';
    await expect(readAttestedTradeHistoryV2View({ capability, deployment,
      data: METADATA.encodeFunctionData('contractVersion') })).rejects.toThrow(/runtime/);
  });
  it('rejects Link version mismatch and a forged or foreign-capability deployment', async () => {
    const provider = new ScriptedProvider(), capability = await bind(provider);
    await expect(attestTradeHistoryV2Deployment({ capability,
      manifest: { ...MANIFEST, protocol: 'link-v2' }, finalityLagBlocks: LAG })).rejects.toThrow(/version/);
    provider.version = 'ChainWhisperLinkOTCEscrowV2';
    const deployment = await attestTradeHistoryV2Deployment({ capability,
      manifest: { ...MANIFEST, protocol: 'link-v2' }, finalityLagBlocks: LAG });
    const data = METADATA.encodeFunctionData('contractVersion');
    await expect(readAttestedTradeHistoryV2View({ capability, deployment: { ...deployment }, data }))
      .rejects.toThrow(/attested/);
    await expect(readAttestedTradeHistoryV2View({ capability: await bind(provider), deployment, data }))
      .rejects.toThrow(/attested/);
  });
});

const standardLog = (
  provider: ScriptedProvider,
  overrides: Partial<Record<'status' | 'blockNumber' | 'transactionIndex' | 'logIndex', bigint>> & {
    removed?: boolean;
  } = {}
) => {
  const blockNumber = overrides.blockNumber ?? 120n;
  const transactionIndex = overrides.transactionIndex ?? 1n;
  const logIndex = overrides.logIndex ?? 4n;
  const transactionHash = hash('aa');
  const event = STANDARD.getEvent('StandardTradeFilled');
  if (!event) throw new Error('Missing StandardTradeFilled ABI.');
  const encoded = STANDARD.encodeEventLog(event, [1n, FILLER, MAKER, 25n, 10n, 90n, 225n, 2n, false]);
  const configured = provider.blocks.get(blockNumber.toString()) ?? {
    hash: blockHash(blockNumber),
    transactions: []
  };
  while (configured.transactions.length <= Number(transactionIndex)) configured.transactions.push(hash('ee'));
  configured.transactions[Number(transactionIndex)] = transactionHash;
  provider.blocks.set(blockNumber.toString(), configured);
  const raw = {
    address: CONTRACT,
    topics: encoded.topics,
    data: encoded.data,
    blockNumber: quantity(blockNumber),
    blockHash: configured.hash,
    transactionHash,
    transactionIndex: quantity(transactionIndex),
    logIndex: quantity(logIndex),
    removed: overrides.removed ?? false
  };
  provider.receipts.set(transactionHash, {
    status: quantity(overrides.status ?? 1n),
    blockNumber: quantity(blockNumber),
    blockHash: configured.hash,
    transactionHash,
    transactionIndex: quantity(transactionIndex),
    logs: [{ ...raw, removed: undefined }]
  });
  return raw;
};

describe('tradeHistoryV2Chain', () => {
  it.each(['link-v2', 'counter-v2'] as const)('permits an explicit bounded wide participant range for %s only', async protocol => {
    const provider = new ScriptedProvider();
    provider.latest = 100_120n;
    provider.version = protocol === 'link-v2' ? 'ChainWhisperLinkOTCEscrowV2' : 'ChainWhisperCounterOTCEscrowV2';
    const capability = await bind(provider);
    const deployment = await attestTradeHistoryV2Deployment({ capability, manifest: { ...MANIFEST, protocol }, finalityLagBlocks: LAG });
    const input = { capability, deployment, fromBlock: 110n, toBlock: 100_109n, topics: [hash('ab')], participantRange: true };
    const page = await readCanonicalTradeV2RawLogRange(input);
    expect(page.range).toMatchObject({ fromBlock: '110', toBlock: '100109' });
    expect(page.logs).toEqual([]);
    await expect(readCanonicalTradeV2RawLogRange({ ...input, toBlock: 100_110n })).rejects.toThrow(/bounded/);
    await expect(readCanonicalTradeV2RawLogRange({ ...input, participantRange: false })).rejects.toThrow(/bounded/);
  });

  it('does not widen the generic protocol boundary in participant mode', async () => {
    const { provider, capability, deployment } = await attest();
    provider.calls.length = 0;
    const input = { capability, deployment, fromBlock: 110n, toBlock: 130n, topics: [hash('ab')], participantRange: true };
    await expect(readCanonicalTradeV2RawLogRange(input)).rejects.toThrow(/participant/i);
    expect(provider.calls).toEqual([]);
  });

  it('brands only a successful oversized log response for bounded page fallback', async () => {
    const { provider, capability, deployment } = await attest();
    provider.logs = Array.from({ length: 4097 }, () => null);
    await expect(readCanonicalTradeV2RawLogRange({ capability, deployment, fromBlock: 110n, toBlock: 130n, topics: [hash('ab')] }))
      .rejects.toMatchObject({ name: 'TradeHistoryV2RangeLimitError' });
  });

  it('keeps sparse canonical participant events across an 85000-block gap with fewer requests', async () => {
    const run = async (span: bigint) => {
      const provider = new ScriptedProvider();
      provider.latest = 85_100n + LAG;
      provider.version = 'ChainWhisperLinkOTCEscrowV2';
      const raw = standardLog(provider), abi = new Interface(LINK_TRADE_V2_ABI);
      const opened = { ...raw, ...abi.encodeEventLog(abi.getEvent('LinkOpened')!, [1n, MAKER, false, address('44'), address('55'), 100n, [2n, 3n], hash('ab'), 0n]) };
      provider.logs = [opened]; provider.receipts.get(raw.transactionHash)!.logs = [opened];
      const request = provider.request.bind(provider);
      provider.request = async args => {
        const result = await request(args);
        if (args.method !== 'eth_getLogs') return result;
        const range = args.params![0] as { fromBlock: string; toBlock: string };
        return (result as { blockNumber: string }[]).filter(log => BigInt(log.blockNumber) >= BigInt(range.fromBlock) && BigInt(log.blockNumber) <= BigInt(range.toBlock));
      };
      const capability = await bind(provider);
      const deployment = await attestTradeHistoryV2Deployment({ capability, manifest: { ...MANIFEST, protocol: 'link-v2' }, finalityLagBlocks: LAG });
      provider.calls.length = 0;
      const logs = [];
      let pages = 0;
      for (let fromBlock = 110n; fromBlock <= 85_100n; fromBlock += span) {
        const toBlock = fromBlock + span - 1n < 85_100n ? fromBlock + span - 1n : 85_100n;
        const page = await readCanonicalTradeV2RawLogRange({ capability, deployment, fromBlock, toBlock,
          topics: [abi.getEvent('LinkOpened')!.topicHash], participantRange: span > 2048n });
        logs.push(...page.logs); pages++;
      }
      return { pages, requests: provider.calls.length, logs };
    };
    const small = await run(2048n), wide = await run(100_000n);
    expect(wide.logs).toEqual(small.logs);
    expect(wide.logs).toHaveLength(1);
    expect(small.pages).toBe(42); expect(wide.pages).toBe(1);
    expect(wide.requests).toBeLessThan(small.requests / 20);
    console.info('P2P_PARTICIPANT_RANGE_COST', JSON.stringify({ small: { pages: small.pages, requests: small.requests }, wide: { pages: wide.pages, requests: wide.requests } }));
  });

  it('measures bounded empty-range and owner-topic RPC method counts', async () => {
    const provider = new ScriptedProvider();
    provider.latest = 4_200n;
    const context = await attest(provider);
    // Keep setup attestation out of the range-read measurement.
    provider.calls.length = 0;

    const fromBlock = 100n;
    const toBlock = fromBlock + 2_047n;
    const topicAddress = (value: string) => `0x${value.slice(2).padStart(64, '0')}`;
    const openedTopic = STANDARD.getEvent('StandardTradeOpened')!.topicHash;
    const methodCounts = (calls: readonly RpcCall[]) => Object.fromEntries(
      [...new Set(calls.map(call => call.method))].sort().map(method => [method, calls.filter(call => call.method === method).length])
    );
    const read = (owner: string) => readCanonicalTradeV2RawLogRange({
      capability: context.capability,
      deployment: context.deployment,
      fromBlock,
      toBlock,
      topics: [openedTopic, topicAddress(owner)]
    });

    const emptyStart = provider.calls.length;
    const empty = await read(MAKER);
    const emptyCounts = methodCounts(provider.calls.slice(emptyStart));
    expect(empty.range).toMatchObject({ fromBlock: '100', toBlock: '2147' });
    expect(empty.logs).toEqual([]);
    expect(empty.receiptLogs).toEqual({});

    const firstOwnerStart = provider.calls.length;
    const firstOwner = await read(MAKER);
    const firstOwnerCounts = methodCounts(provider.calls.slice(firstOwnerStart));
    expect(firstOwner.logs).toEqual([]);

    const secondOwnerStart = provider.calls.length;
    const secondOwner = await read(FILLER);
    const secondOwnerCounts = methodCounts(provider.calls.slice(secondOwnerStart));
    expect(secondOwner.logs).toEqual([]);

    const rangeCalls = provider.calls;
    const blockNumbers = rangeCalls.filter(call => call.method === 'eth_getBlockByNumber')
      .map(call => BigInt(String(call.params[0])).toString());
    expect(new Set(blockNumbers)).toEqual(new Set([
      fromBlock.toString(), toBlock.toString(), context.deployment.attestationBlock.number
    ]));
    expect(rangeCalls.filter(call => call.method === 'eth_getTransactionReceipt')).toHaveLength(0);
    expect(rangeCalls.filter(call => call.method === 'eth_getLogs')).toHaveLength(3);
    expect(rangeCalls.filter(call => call.method === 'eth_getLogs').map(call =>
      (call.params[0] as { topics: string[] }).topics[1]
    )).toEqual([topicAddress(MAKER), topicAddress(MAKER), topicAddress(FILLER)]);
    expect(firstOwnerCounts).toEqual(emptyCounts);
    expect(secondOwnerCounts).toEqual(emptyCounts);

    console.info('P2P_HISTORY_METHOD_COUNTS', JSON.stringify({
      emptyRange: emptyCounts,
      ownerTopicA: firstOwnerCounts,
      ownerTopicB: secondOwnerCounts
    }));
  });

  it('uses the same canonical boundary for Link logs and fetches a shared receipt once', async () => {
    const provider = new ScriptedProvider(); provider.version = 'ChainWhisperLinkOTCEscrowV2';
    const capability = await bind(provider), deployment = await attestTradeHistoryV2Deployment({ capability, manifest: { ...MANIFEST, protocol: 'link-v2' }, finalityLagBlocks: LAG });
    const raw = standardLog(provider), link = new Interface(LINK_TRADE_V2_ABI);
    const opened = { ...raw, ...link.encodeEventLog(link.getEvent('LinkOpened')!, [1n, MAKER, false, address('44'), address('55'), 100n, [2n, 3n], hash('ab'), 0n]) };
    const changed = { ...raw, logIndex: '0x5', ...link.encodeEventLog(link.getEvent('LinkCredentialChanged')!, [1n, 2n, 2n, false]) };
    provider.logs = [changed, opened]; provider.receipts.get(raw.transactionHash)!.logs = [opened, changed];
    const page = await readCanonicalTradeV2RawLogRange({ capability, deployment, fromBlock: 110n, toBlock: 130n,
      topics: [[link.getEvent('LinkOpened')!.topicHash, link.getEvent('LinkCredentialChanged')!.topicHash]] });
    expect(page.logs.map(log => log.logIndex)).toEqual(['0x4', '0x5']);
    expect(page.receiptLogs[raw.transactionHash]).toHaveLength(2);
    expect(provider.calls.filter(call => call.method === 'eth_getTransactionReceipt')).toHaveLength(1);
  });
  it('rejects off-filter Link logs and inconsistent receipt origins without accepting a page', async () => {
    for (const failure of ['topic', 'receipt']) {
      const provider = new ScriptedProvider(); provider.version = 'ChainWhisperLinkOTCEscrowV2';
      const capability = await bind(provider), deployment = await attestTradeHistoryV2Deployment({ capability, manifest: { ...MANIFEST, protocol: 'link-v2' }, finalityLagBlocks: LAG });
      const raw = standardLog(provider), link = new Interface(LINK_TRADE_V2_ABI), topic = link.getEvent('LinkOpened')!.topicHash;
      const opened = { ...raw, ...link.encodeEventLog(link.getEvent('LinkOpened')!, [1n, MAKER, false, address('44'), address('55'), 100n, [2n, 3n], hash('ab'), 0n]) };
      provider.logs = [opened]; provider.receipts.get(raw.transactionHash)!.logs = [opened];
      if (failure === 'receipt') provider.receipts.get(raw.transactionHash)!.logs = [opened, { ...opened, logIndex: '0x5', transactionHash: hash('bb') }];
      await expect(readCanonicalTradeV2RawLogRange({ capability, deployment, fromBlock: 110n, toBlock: 130n,
        topics: [[failure === 'topic' ? link.getEvent('LinkClosed')!.topicHash : topic]] })).rejects.toThrow(/topics|origins/);
    }
  });
  const currentPrivateContext = async () => {
    const provider = new ScriptedProvider(); provider.code = currentArtifact.deployedBytecode; provider.version = 'ChainWhisperPrivateOTCEscrowV2';
    const capability = await bind(provider);
    const deployment = await attestTradeHistoryV2Deployment({ capability, manifest: { ...MANIFEST, protocol: 'private-v2', runtimeBytecodeHash: PRIVATE_BOOK_V2_HISTORY_RUNTIME_HASH }, finalityLagBlocks: LAG });
    const abi = new Interface(currentArtifact.abi); const txHash = hash('aa');
    const ut = (value: bigint) => [[0n, value], [0n, value]];
    const contents = [
      abi.encodeEventLog(abi.getEvent('PrivateOrderOpened')!, [1n, MAKER, hash('bb'), 0, 2, address('44'), 0n, 2, address('55'), 0n, [1n, 2n], [false, 0, 0], 120n, 0n, 1n, 1n]),
      abi.encodeEventLog(abi.getEvent('PrivateOrderAccountSnapshotUpdated')!, [1n, MAKER, FILLER, 2n, ut(999n), ut(1998n), ut(989n), ut(10n), ut(20n)]),
      abi.encodeEventLog(abi.getEvent('PrivateOrderAccountSnapshotUpdated')!, [1n, FILLER, FILLER, 2n, ut(0n), ut(0n), ut(0n), ut(10n), ut(20n)]),
      abi.encodeEventLog(abi.getEvent('PrivateOrderFilled')!, [1n, FILLER, MAKER, 0, 2n, 1n, 0n, 0n])
    ];
    provider.blocks.set('120', { hash: blockHash(120n), transactions: [txHash] });
    provider.logs = contents.map((event, i) => ({ ...event, address: CONTRACT, blockNumber: '0x78', blockHash: blockHash(120n), transactionHash: txHash, transactionIndex: '0x0', logIndex: quantity(i), removed: false }));
    provider.receipts.set(txHash, { status: '0x1', blockNumber: '0x78', blockHash: blockHash(120n), transactionHash: txHash, transactionIndex: '0x0', logs: [...provider.logs] });
    return { provider, capability, deployment, abi };
  };
  it('queries current topics and canonically joins only the viewer receipt, excluding maker totals', async () => {
    const c = await currentPrivateContext();
    const canonicalPage = await readCanonicalTradeHistoryV2LogRange({ capability: c.capability, deployment: c.deployment, fromBlock: 120n, toBlock: 120n });
    expect(canonicalPage.events).toHaveLength(4);
    const topics = (c.provider.calls.find(call => call.method === 'eth_getLogs')!.params[0] as { topics: string[][] }).topics[0];
    expect(topics).toContain(c.abi.getEvent('PrivateOrderFilled')!.topicHash);
    expect(topics).not.toContain(new Interface(TRADE_HISTORY_V2_EVENT_ABIS.private).getEvent('PrivateOrderFilled')!.topicHash);
    const resolve = vi.fn(async receipt => {
      expect(receipt.recipient).toBe(FILLER);
      expect(receipt.encryptedAmounts).not.toHaveProperty('totalOfferAmount');
      expect(receipt.encryptedAmounts).not.toHaveProperty('remainingOfferAmount');
      return { offerAmount: receipt.encryptedAmounts.offerAmount.userCiphertextLow, requestAmount: receipt.encryptedAmounts.requestAmount.userCiphertextLow };
    });
    const result = await materializeCanonicalTradeHistoryV2Range({ previous: createTradeHistoryV2MaterializationState(), canonicalPage, chainId: CHAIN_ID.toString(), contractAddress: CONTRACT, expectedRevision: 0, viewer: FILLER, resolvePrivateReceiptAmounts: resolve });
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(result.page.observations).toHaveLength(2);
    expect(result.page.observations.find(item => item.source === 'participant-receipt')).toMatchObject({ amounts: { offerAmount: '10', requestAmount: '20' }, recipient: FILLER });
    const outsiderResolve = vi.fn();
    await materializeCanonicalTradeHistoryV2Range({ previous: createTradeHistoryV2MaterializationState(), canonicalPage, chainId: CHAIN_ID.toString(), contractAddress: CONTRACT, expectedRevision: 0, viewer: address('66'), resolvePrivateReceiptAmounts: outsiderResolve });
    expect(outsiderResolve).not.toHaveBeenCalled();
  });
  it('keeps the same participant history with fewer bounded backfill reads', async () => {
    const run = async (maxBlockSpan: bigint) => {
      const c = await currentPrivateContext();
      c.provider.latest = 4_200n;
      const request = c.provider.request.bind(c.provider);
      c.provider.request = async args => {
        const result = await request(args);
        if (args.method !== 'eth_getLogs') return result;
        const filter = args.params![0] as { fromBlock: string; toBlock: string };
        return (result as { blockNumber: string }[]).filter(log => BigInt(log.blockNumber) >= BigInt(filter.fromBlock) && BigInt(log.blockNumber) <= BigInt(filter.toBlock));
      };
      // Bind after installing the range-aware fake RPC, as the real reader captures request.
      const capability = await bind(c.provider);
      const deployment = await attestTradeHistoryV2Deployment({ capability, manifest: { ...MANIFEST, protocol: 'private-v2', runtimeBytecodeHash: PRIVATE_BOOK_V2_HISTORY_RUNTIME_HASH }, finalityLagBlocks: LAG });
      let state = { sync: createTradeHistoryV2SyncState(createTradeHistoryV2LedgerState()), materialization: createTradeHistoryV2MaterializationState() };
      c.provider.calls.length = 0;
      let pages = 0, hasMore = true;
      while (hasMore) {
        const result = await syncTradeHistoryV2PipelineRange({ previous: state,
          scope: { chainId: deployment.chainId, contractAddress: deployment.contractAddress, deploymentBlock: deployment.deploymentBlock },
          capability, deployment, confirmationDepth: LAG, maxBlockSpan, overlapBlocks: 16n, viewer: FILLER,
          reads: { getLatestBlockNumber: () => readTradeHistoryV2LatestBlockNumber(capability),
            readCanonicalBlock: (_chain, blockNumber) => readTradeHistoryV2CanonicalBlock({ capability, blockNumber: BigInt(blockNumber) }) },
          resolvePrivateReceiptAmounts: async receipt => ({ offerAmount: receipt.encryptedAmounts.offerAmount!.userCiphertextLow, requestAmount: receipt.encryptedAmounts.requestAmount!.userCiphertextLow }),
          expectedLedgerRevision: getTradeHistoryV2LedgerRevision({ state: state.sync.ledger, chainId: deployment.chainId, contractAddress: deployment.contractAddress }),
          expectedMaterializationRevision: getTradeHistoryV2MaterializationRevision({ state: state.materialization, chainId: deployment.chainId, contractAddress: deployment.contractAddress }) });
        state = result.state; hasMore = result.hasMore; pages++;
      }
      return { pages, calls: c.provider.calls.length, rows: projectTradeHistoryV2Rows({ state: state.sync.ledger, viewerAddress: FILLER }) };
    };
    const small = await run(512n), large = await run(2_048n);
    expect(large.rows).toEqual(small.rows);
    expect(large.rows).toHaveLength(1);
    expect(large.rows[0]).toMatchObject({ amounts: { offerAmount: '10', requestAmount: '20' } });
    expect(large.pages).toBe(3);
    expect(small.pages).toBe(9);
    expect(large.calls).toBeLessThan(small.calls / 2);
    console.info('P2P_HISTORY_READ_COMPARISON', JSON.stringify({ small: { pages: small.pages, requests: small.calls }, large: { pages: large.pages, requests: large.calls } }));
  });
  it('keeps duplicate and orphan receipt guards for the promoted private contract', async () => {
    const duplicate = await currentPrivateContext(); duplicate.provider.logs.push(duplicate.provider.logs[0]);
    await expect(readCanonicalTradeHistoryV2LogRange({ ...duplicate, fromBlock: 120n, toBlock: 120n })).rejects.toThrow(/duplicate physical/);
    const orphan = await currentPrivateContext(); orphan.provider.blocks.set('120', { hash: hash('ff'), transactions: [hash('aa')] });
    await expect(readCanonicalTradeHistoryV2LogRange({ ...orphan, fromBlock: 120n, toBlock: 120n })).rejects.toThrow(/orphan/);
  });
  it('does not guess an ABI for an unknown private runtime', async () => {
    const provider = new ScriptedProvider(); provider.version = 'ChainWhisperPrivateOTCEscrowV2';
    const capability = await bind(provider);
    const deployment = await attestTradeHistoryV2Deployment({ capability, manifest: { ...MANIFEST, protocol: 'private-v2' }, finalityLagBlocks: LAG });
    await expect(readCanonicalTradeHistoryV2LogRange({ capability, deployment, fromBlock: 120n, toBlock: 120n })).rejects.toThrow(/no admitted event ABI/);
    expect(provider.calls.some(call => call.method === 'eth_getLogs')).toBe(false);
  });
  it('attests exact runtime, version, required features, chain, and nonzero finality at one snapshot', async () => {
    const context = await attest();
    expect(context.deployment).toMatchObject({
      protocol: 'standard-v2',
      chainId: CHAIN_ID.toString(),
      contractAddress: CONTRACT,
      deploymentBlock: DEPLOYMENT_BLOCK.toString(),
      runtimeBytecodeHash: keccak256(CODE),
      contractVersion: 'ChainWhisperStandardOTCEscrowV2',
      attestationBlock: { number: SAFE_HEAD.toString(), hash: blockHash(SAFE_HEAD) }
    });
    const pinnedReads = context.provider.calls.filter(({ method }) => method === 'eth_getCode' || method === 'eth_call');
    expect(pinnedReads.every(({ params }) => {
      const selector = params[1] as { blockHash?: string; requireCanonical?: boolean };
      return selector.blockHash === blockHash(SAFE_HEAD) && selector.requireCanonical === true;
    })).toBe(true);
  });

  it('owns a complete bounded range and admits only successful receipt-bound canonical logs', async () => {
    const context = await attest();
    const raw = standardLog(context.provider);
    context.provider.logs = [raw];
    const page = await readCanonicalTradeHistoryV2LogRange({
      capability: context.capability,
      deployment: context.deployment,
      fromBlock: 120n,
      toBlock: 123n
    });
    expect(page.range).toEqual({
      fromBlock: '120',
      toBlock: '123',
      fromBlockHash: blockHash(120n),
      toBlockHash: blockHash(123n)
    });
    expect(page.scope).toEqual({
      protocol: 'standard-v2',
      chainId: CHAIN_ID.toString(),
      contractAddress: CONTRACT,
      deploymentBlock: DEPLOYMENT_BLOCK.toString()
    });
    expect(page.events).toHaveLength(1);
    expect(page.events[0]).toMatchObject({
      kind: 'execution',
      contractRevision: '2',
      observation: { sequence: '1', amounts: { offerAmount: '10', requestAmount: '25' } }
    });
    expect(() => assertCanonicalTradeHistoryV2LogRange(page)).not.toThrow();
    expect(Object.isFrozen(page.events[0])).toBe(true);
    expect(Object.isFrozen(page.events[0].kind === 'execution' ? page.events[0].observation.amounts : {})).toBe(true);
    const getLogs = context.provider.calls.find(({ method }) => method === 'eth_getLogs');
    expect(getLogs?.params[0]).toMatchObject({ address: CONTRACT, fromBlock: '0x78', toBlock: '0x7b' });
  });

  it.each([
    ['private-v2', 'ChainWhisperPrivateOTCEscrowV2'],
    ['direct-v2', 'ChainWhisperDirectOTCEscrowV2'],
    ['recurring-v2', 'ChainWhisperRecurringOTCEscrowV2'],
    ['private-recurring-v2', 'ChainWhisperPrivateRecurringOTCEscrowV2']
  ] as const)('binds the exact %s version and feature policy', async (protocol, version) => {
    const provider = new ScriptedProvider();
    provider.version = version;
    const capability = await bind(provider);
    await expect(attestTradeHistoryV2Deployment({
      capability,
      manifest: { ...MANIFEST, protocol },
      finalityLagBlocks: LAG
    })).resolves.toMatchObject({ protocol, contractVersion: version });
  });

  it('fails attestation on runtime, version, required-feature, app-wallet, and finality mismatches', async () => {
    const runtime = new ScriptedProvider();
    runtime.code = '0x6002600055';
    await expect(attest(runtime)).rejects.toThrow(/runtime/);

    const version = new ScriptedProvider();
    version.version = 'SpoofedStandardV2';
    await expect(attest(version)).rejects.toThrow(/version/);

    const feature = new ScriptedProvider();
    feature.unsupportedFeatures.add(keccak256(toUtf8Bytes('PUBLIC_DESK')).toLowerCase());
    await expect(attest(feature)).rejects.toThrow(/PUBLIC_DESK/);

    const appWallet = new ScriptedProvider();
    appWallet.appWalletExecutor = true;
    await expect(attest(appWallet)).rejects.toThrow(/app-wallet/);

    const provider = new ScriptedProvider();
    const capability = await bind(provider);
    await expect(attestTradeHistoryV2Deployment({ capability, manifest: MANIFEST, finalityLagBlocks: 0n }))
      .rejects.toThrow(/non-zero/);
  });

  it('rejects removed, failed, orphaned, duplicate, and receipt-mismatched logs', async () => {
    const removed = await attest();
    removed.provider.logs = [standardLog(removed.provider, { removed: true })];
    await expect(readCanonicalTradeHistoryV2LogRange({
      capability: removed.capability, deployment: removed.deployment, fromBlock: 120n, toBlock: 123n
    })).rejects.toThrow(/removed/i);

    const failed = await attest();
    failed.provider.logs = [standardLog(failed.provider, { status: 0n })];
    await expect(readCanonicalTradeHistoryV2LogRange({
      capability: failed.capability, deployment: failed.deployment, fromBlock: 120n, toBlock: 123n
    })).rejects.toThrow(/unsuccessful/);

    const duplicate = await attest();
    const raw = standardLog(duplicate.provider);
    duplicate.provider.logs = [raw, raw];
    await expect(readCanonicalTradeHistoryV2LogRange({
      capability: duplicate.capability, deployment: duplicate.deployment, fromBlock: 120n, toBlock: 123n
    })).rejects.toThrow(/duplicate physical/);

    const receiptMismatch = await attest();
    const valid = standardLog(receiptMismatch.provider);
    const receipt = receiptMismatch.provider.receipts.get(valid.transactionHash)!;
    receipt.logs = [{ ...valid, data: '0x' }];
    receiptMismatch.provider.logs = [valid];
    await expect(readCanonicalTradeHistoryV2LogRange({
      capability: receiptMismatch.capability,
      deployment: receiptMismatch.deployment,
      fromBlock: 120n,
      toBlock: 123n
    })).rejects.toThrow(/exactly match/);
  });

  it('rejects forged structural deployments and capabilities', async () => {
    const context = await attest();
    await expect(readCanonicalTradeHistoryV2LogRange({
      capability: Object.freeze({}) as TradeHistoryV2ReadCapability,
      deployment: context.deployment,
      fromBlock: 120n,
      toBlock: 123n
    })).rejects.toThrow(/exact current/);
    await expect(readCanonicalTradeHistoryV2LogRange({
      capability: context.capability,
      deployment: { ...context.deployment } as AttestedTradeHistoryV2Deployment,
      fromBlock: 120n,
      toBlock: 123n
    })).rejects.toThrow(/not attested/);
    expect(() => assertCanonicalTradeHistoryV2LogRange({
      scope: {
        protocol: 'standard-v2', chainId: CHAIN_ID.toString(),
        contractAddress: CONTRACT, deploymentBlock: DEPLOYMENT_BLOCK.toString()
      },
      range: {
        fromBlock: '120', toBlock: '123',
        fromBlockHash: blockHash(120n), toBlockHash: blockHash(123n)
      },
      safeHead: { number: SAFE_HEAD.toString(), hash: blockHash(SAFE_HEAD) },
      checkedBlocks: [],
      events: []
    } as never)).toThrow(/not a provider-owned canonical page/);
  });

  it('rejects ranges before deployment, above the safe head, or above the page cap', async () => {
    const context = await attest();
    await expect(readCanonicalTradeHistoryV2LogRange({
      capability: context.capability, deployment: context.deployment, fromBlock: 99n, toBlock: 100n
    })).rejects.toThrow(/predates/);
    await expect(readCanonicalTradeHistoryV2LogRange({
      capability: context.capability, deployment: context.deployment, fromBlock: 145n, toBlock: 146n
    })).rejects.toThrow(/above the safe head/);
    await expect(readCanonicalTradeHistoryV2LogRange({
      capability: context.capability, deployment: context.deployment, fromBlock: 100n, toBlock: 2_148n
    })).rejects.toThrow(/bounded/);
  });

  it('fails closed if the deployment attestation block is reorganized', async () => {
    const provider = new ScriptedProvider();
    const capability = await bind(provider);
    const deployment = await attestTradeHistoryV2Deployment({
      capability,
      manifest: MANIFEST,
      finalityLagBlocks: LAG
    });
    provider.reorgAttestation = true;
    await expect(readCanonicalTradeHistoryV2LogRange({
      capability, deployment, fromBlock: 120n, toBlock: 123n
    })).rejects.toThrow(/attestation block was reorganized/);
  });

  it('captures the provider request function and rechecks the supplied lease around RPC work', async () => {
    const provider = new ScriptedProvider();
    const assertCurrent = vi.fn(async () => undefined);
    const capability = await bind(provider, assertCurrent);
    const capturedRequest = provider.request;
    provider.request = async () => { throw new Error('replacement must not be used'); };
    await expect(attestTradeHistoryV2Deployment({
      capability,
      manifest: MANIFEST,
      finalityLagBlocks: LAG
    })).resolves.toBeDefined();
    expect(provider.request).not.toBe(capturedRequest);
    expect(assertCurrent.mock.calls.length).toBeGreaterThan(10);
  });
});

