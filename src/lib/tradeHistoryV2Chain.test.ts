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
  readCanonicalCounterTradeV2ParticipantRange,
  readTradeHistoryV2WalletIndex,
  type AttestedTradeHistoryV2Deployment,
  type TradeHistoryV2ManifestInput,
  type TradeHistoryV2ReadCapability
} from './tradeHistoryV2Chain';
import { TRADE_HISTORY_V2_EVENT_ABIS, PRIVATE_BOOK_V2_HISTORY_RUNTIME_HASH } from './tradeHistoryV2Events';
import { LINK_TRADE_V2_ABI } from './linkTradeV2Abi';
import { COUNTER_TRADE_V2_ABI } from './counterTradeV2Abi';
import { createCounterTradeV2ActivityReader } from './counterTradeV2Activity';
import * as ownerCapability from './ownerTradeV2Capability';
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
const INDEX = new Interface(['getTradeIdsForMaker', 'getTradeIdsForFiller', 'getTradeIdsForTaker', 'getOrderIdsForMaker', 'getOrderIdsForFiller']
  .map(name => `function ${name}(address owner,uint256 offset,uint256 limit) view returns (uint256[],uint256)`));
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
  walletIds = new Map<string, bigint[]>();
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
      const index = INDEX.parseTransaction({ data: call.data });
      if (index) {
        const ids = this.walletIds.get(index.name) ?? [];
        const offset = Number(index.args[1]), end = Math.min(ids.length, offset + Number(index.args[2]));
        return INDEX.encodeFunctionResult(index.name, [ids.slice(offset, end), end < ids.length ? end : 0]);
      }
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
  const setup = (deploymentBlocks?: readonly bigint[]) => {
    const provider = new ScriptedProvider();
    if (deploymentBlocks) provider.code = currentArtifact.deployedBytecode;
    const protocols = ['standard-v2', 'private-v2', 'direct-v2'] as const;
    const versions = ['ChainWhisperStandardOTCEscrowV2', 'ChainWhisperPrivateOTCEscrowV2', 'ChainWhisperDirectOTCEscrowV2'];
    const descriptor = (protocol: typeof protocols[number], index: number) => {
      const contractAddress = address((32 + index).toString(16));
      provider.versions.set(contractAddress, versions[protocols.indexOf(protocol)]);
      return { protocol, manifest: { ...MANIFEST, protocol, contractAddress,
        runtimeBytecodeHash: keccak256(provider.code),
        deploymentBlock: deploymentBlocks?.[index] ?? MANIFEST.deploymentBlock } };
    };
    const deployments = Object.fromEntries(protocols.map((protocol, index) => [protocol, descriptor(protocol, index)]));
    const catalog = { status: 'active', chainId: CHAIN_ID.toString(), deployments, finalityLagBlocks: LAG,
      preparedP2p: { status: 'book-admitted' } };
    return { provider, create: (assertCurrent = () => {}) => createOtcTradeHistoryV2Runtime({
      catalog: catalog as never, provider, ownerAddress: MAKER, assertCurrent
    }) };
  };

  it('uses one canonical setup boundary for only the three current contracts', async () => {
    const { provider, create } = setup();
    const runtime = await create();
    expect(provider.calls).toHaveLength(31);
    expect(provider.calls.filter(call => call.method === 'eth_blockNumber')).toHaveLength(1);
    expect(provider.calls.filter(call => call.method === 'eth_getBlockByNumber')).toHaveLength(2);
    expect(provider.calls.filter(call => call.method === 'eth_chainId')).toHaveLength(4);
    expect(provider.calls.filter(call => call.method === 'eth_getCode')).toHaveLength(3);
    expect(provider.calls.filter(call => call.method === 'eth_call')).toHaveLength(21);
    for (const call of provider.calls.filter(call => ['eth_getCode', 'eth_call'].includes(call.method))) {
      expect(call.params[1]).toEqual({ blockHash: blockHash(SAFE_HEAD), requireCanonical: true });
    }
    const deployments = Object.values(runtime.deployments);
    expect(deployments.every(item => item.attestationBlock.hash === blockHash(SAFE_HEAD))).toBe(true);
    runtime.close();
  });
  it('rejects a reorg before exposing the setup result', async () => {
    const { provider, create } = setup();
    provider.reorgAttestation = true;
    await expect(create()).rejects.toThrow(/reorganized/);
  });

  it('completes empty wallet history from current participant indexes without global log scans', async () => {
    // Current binding blocks; nearby saved head. Empty logs isolate the scan's fixed work.
    const blocks = [10_288_990n, 10_289_000n, 10_289_009n];
    const { provider, create } = setup(blocks);
    provider.latest = 10_368_834n + LAG;
    const runtime = await create();
    provider.calls.length = 0;
    try {
      const result = await runtime.sync();
      expect(result.hasMore).toBe(false);
      expect(Object.values(result.byProtocol).every(item => item.safeHead === '10368834')).toBe(true);
      const scans = provider.calls.filter(call => call.method === 'eth_getLogs');
      expect(scans).toHaveLength(0);
      const coldCalls = provider.calls.length;
      await runtime.sync();
      expect(provider.calls.filter(call => call.method === 'eth_getLogs')).toHaveLength(0);
      const refreshCalls = provider.calls.length - coldCalls;
      provider.calls.length = 0;
      for (const deployment of Object.values(runtime.deployments)) {
        await syncTradeHistoryV2PipelineRange({
          previous: { sync: createTradeHistoryV2SyncState(createTradeHistoryV2LedgerState()),
            materialization: createTradeHistoryV2MaterializationState() },
          scope: deployment, capability: runtime.readCapability, deployment,
          confirmationDepth: LAG, maxBlockSpan: 100_000n, overlapBlocks: 16n,
          reads: { getLatestBlockNumber: () => readTradeHistoryV2LatestBlockNumber(runtime.readCapability),
            readCanonicalBlock: (_chain, number) => readTradeHistoryV2CanonicalBlock({ capability: runtime.readCapability, blockNumber: BigInt(number) }) },
          viewer: MAKER, expectedLedgerRevision: 0, expectedMaterializationRevision: 0
        });
      }
      const baselineCalls = provider.calls.length;
      expect(coldCalls).toBe(33);
      expect(coldCalls).toBeLessThan(baselineCalls);
      console.info('P2P_WALLET_INDEX_COMPARISON', JSON.stringify({ coldCalls, baselineCalls, refreshCalls,
        scope: 'synthetic empty wallet; same three contracts and range; setup excluded; not native timing' }));
    } finally { runtime.close(); }
  });

  it.each(['code', 'version', 'feature', 'app-wallet', 'chain', 'lease'] as const)('rejects a %s failure late in setup', async failure => {
    const { provider, create } = setup();
    const request = provider.request.bind(provider);
    let revoked = false, reachedLastCurrent = false;
    provider.request = async args => {
      const result = await request(args);
      if ((args.method === 'eth_getCode' && args.params?.[0] === address('22')) ||
          (args.method === 'eth_call' && (args.params?.[0] as { to: string }).to === address('22'))) reachedLastCurrent = true;
      if (!reachedLastCurrent) return result;
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

describe('wallet-indexed canonical history', () => {
  it.each([
    ['standard-v2', 'ChainWhisperStandardOTCEscrowV2', 'getTradeIdsForMaker', 'getTradeIdsForFiller'],
    ['private-v2', 'ChainWhisperPrivateOTCEscrowV2', 'getOrderIdsForMaker', 'getOrderIdsForFiller'],
    ['direct-v2', 'ChainWhisperDirectOTCEscrowV2', 'getTradeIdsForMaker', 'getTradeIdsForTaker']
  ] as const)('reads only the recent page of both %s roles at one canonical block', async (protocol, version, maker, participant) => {
    const provider = new ScriptedProvider(); provider.version = version;
    const capability = await bind(provider);
    const deployment = await attestTradeHistoryV2Deployment({ capability, manifest: { ...MANIFEST, protocol }, finalityLagBlocks: LAG });
    provider.walletIds.set(maker, Array.from({ length: 120 }, (_, index) => BigInt(120 - index)));
    provider.walletIds.set(participant, [1n, 121n]);
    provider.calls.length = 0;
    const index = await readTradeHistoryV2WalletIndex({ capability, deployment, ownerAddress: MAKER });
    expect(index.orderIds).toEqual(['1', ...Array.from({ length: 101 }, (_, i) => String(i + 21))]);
    expect(index.complete).toBe(false);
    const calls = provider.calls.filter(call => call.method === 'eth_call');
    expect(calls).toHaveLength(2);
    expect(calls.every(call => JSON.stringify(call.params[1]) === JSON.stringify({ blockHash: blockHash(SAFE_HEAD), requireCanonical: true }))).toBe(true);
    expect(index.block).toEqual({ number: SAFE_HEAD.toString(), hash: blockHash(SAFE_HEAD) });
  });

  it.each(['cursor', 'empty-cursor', 'duplicate', 'zero', 'reorg', 'runtime', '403'] as const)('rejects %s during index discovery without a partial result', async failure => {
    const { provider, capability, deployment } = await attest();
    const original = provider.request.bind(provider);
    let pages = 0;
    if (failure === 'runtime') provider.code = '0x6002';
    else if (failure === 'reorg') provider.reorgAttestation = true;
    else {
      // A fresh capability captures this adversarial provider, then normal attestation runs.
      provider.request = async args => {
        if (args.method === 'eth_call') {
          const parsed = INDEX.parseTransaction({ data: (args.params![0] as { data: string }).data });
          if (parsed) {
            pages++;
            if (failure === '403') throw new Error('HTTP 403');
            const [ids, next] = failure === 'cursor' ? [[1n], 7n] : failure === 'empty-cursor' ? [[], 1n]
              : failure === 'duplicate' ? [[1n, 1n], 0n] : [[0n], 0n];
            return INDEX.encodeFunctionResult(parsed.name, [ids, next]);
          }
        }
        return original(args);
      };
      const nextCapability = await bind(provider);
      const nextDeployment = await attestTradeHistoryV2Deployment({ capability: nextCapability, manifest: MANIFEST, finalityLagBlocks: LAG });
      await expect(readTradeHistoryV2WalletIndex({ capability: nextCapability, deployment: nextDeployment, ownerAddress: MAKER })).rejects.toThrow();
      expect(pages).toBe(1);
      return;
    }
    await expect(readTradeHistoryV2WalletIndex({ capability, deployment, ownerAddress: MAKER })).rejects.toThrow();
  });

  it('keeps exact fills and terminal lifecycle events using indexed order filters and receipt checks', async () => {
    const { provider, capability, deployment } = await attest();
    const filled = standardLog(provider);
    const closed = { ...filled, logIndex: '0x5', ...STANDARD.encodeEventLog(STANDARD.getEvent('StandardTradeStatusChanged')!,
      [1n, MAKER, 1, 3, MAKER, 0n, 3n]) };
    provider.logs = [filled, closed];
    provider.receipts.get(filled.transactionHash)!.logs = [filled, closed];
    provider.walletIds.set('getTradeIdsForFiller', [1n]);
    const index = await readTradeHistoryV2WalletIndex({ capability, deployment, ownerAddress: FILLER });
    expect(index.complete).toBe(true);
    const input = { capability, deployment, fromBlock: DEPLOYMENT_BLOCK, toBlock: SAFE_HEAD };
    const before = await readCanonicalTradeHistoryV2LogRange(input);
    const scoped = await readCanonicalTradeHistoryV2LogRange({ ...input, walletIndex: index });
    expect(scoped.events).toEqual(before.events);
    const scans = provider.calls.filter(call => call.method === 'eth_getLogs');
    const filter = scans[scans.length - 1].params[0] as { topics: unknown[] };
    expect(filter.topics[1]).toEqual([blockHash(1n)]);
    provider.logs = [{ ...filled, topics: [filled.topics[0], blockHash(2n), ...filled.topics.slice(2)] }];
    await expect(readCanonicalTradeHistoryV2LogRange({ ...input, walletIndex: index })).rejects.toThrow(/topics/);
    provider.logs = [filled]; provider.receipts.get(filled.transactionHash)!.status = '0x0';
    await expect(readCanonicalTradeHistoryV2LogRange({ ...input, walletIndex: index })).rejects.toThrow(/unsuccessful/);
    await expect(readCanonicalTradeHistoryV2LogRange({ ...input, walletIndex: { ...index } })).rejects.toThrow(/index belongs/);
  });

  it('chunks all indexed IDs into bounded filters without omitting older orders', async () => {
    const { provider, capability, deployment } = await attest();
    provider.walletIds.set('getTradeIdsForMaker', Array.from({ length: 65 }, (_, i) => BigInt(i + 1)));
    provider.walletIds.set('getTradeIdsForFiller', Array.from({ length: 65 }, (_, i) => BigInt(i + 66)));
    const index = await readTradeHistoryV2WalletIndex({ capability, deployment, ownerAddress: MAKER });
    expect(index.complete).toBe(true);
    await readCanonicalTradeHistoryV2LogRange({ capability, deployment, walletIndex: index, fromBlock: DEPLOYMENT_BLOCK, toBlock: SAFE_HEAD });
    const filters = provider.calls.filter(call => call.method === 'eth_getLogs')
      .map(call => (call.params[0] as { topics: string[][] }).topics[1]);
    expect(filters.map(ids => ids.length)).toEqual([64, 64, 2]);
    expect(filters.flat().map(id => BigInt(id).toString())).toEqual(index.orderIds);
  });

  it('retains recent fills on old orders when the wallet index has older pages', async () => {
    const { provider, capability, deployment } = await attest();
    provider.walletIds.set('getTradeIdsForFiller', Array.from({ length: 120 }, (_, i) => BigInt(120 - i)));
    const filled = standardLog(provider);
    provider.logs = [filled];
    const index = await readTradeHistoryV2WalletIndex({ capability, deployment, ownerAddress: FILLER });
    expect(index.complete).toBe(false);
    expect(index.orderIds).not.toContain('1');
    const input = { capability, deployment, walletIndex: index, fromBlock: DEPLOYMENT_BLOCK, toBlock: SAFE_HEAD };
    const page = await readCanonicalTradeHistoryV2LogRange(input);
    expect(page.events).toHaveLength(1);
    const filters = provider.calls.filter(call => call.method === 'eth_getLogs');
    expect((filters[0].params[0] as { topics: unknown[] }).topics).toHaveLength(1);
    provider.receipts.get(filled.transactionHash)!.status = '0x0';
    await expect(readCanonicalTradeHistoryV2LogRange(input)).rejects.toThrow(/unsuccessful/);
  });
});

describe('Counter shared participant range', () => {
  const abi = new Interface(COUNTER_TRADE_V2_ABI);
  const opened = abi.getEvent('CounterOpened')!.topicHash;
  const topicOwner = `0x${MAKER.slice(2).padStart(64, '0')}`;
  const filters = [[opened, null, topicOwner], [opened, null, null, topicOwner]];
  const setup = async (options: {
    assertCurrent?: () => void;
    onRequest?: (input: RpcCall, result: unknown, provider: ScriptedProvider) => unknown;
  } = {}) => {
    const provider = new ScriptedProvider();
    provider.version = 'ChainWhisperCounterOTCEscrowV2';
    const original = provider.request.bind(provider);
    provider.request = async input => {
      const result = await original(input);
      return options.onRequest ? options.onRequest({ method: input.method, params: input.params ?? [] }, result, provider) : result;
    };
    const capability = await bind(provider, options.assertCurrent);
    const deployment = await attestTradeHistoryV2Deployment({ capability,
      manifest: { ...MANIFEST, protocol: 'counter-v2' }, finalityLagBlocks: LAG });
    provider.calls.length = 0;
    return { provider, capability, deployment, fromBlock: 110n, toBlock: 130n, ownerAddress: MAKER };
  };
  const fill = (provider: ScriptedProvider, bothRoles = false) => {
    const raw = standardLog(provider);
    const event = (id: bigint, maker: string, taker: string, logIndex: string) => ({
      ...raw, logIndex, ...abi.encodeEventLog(abi.getEvent('CounterOpened')!, [id, maker, taker,
        hash('ab'), 0n, 1n, address('44'), address('55'), false, 4n, 5n, 0n])
    });
    const logs = [event(1n, MAKER, bothRoles ? MAKER : FILLER, '0x4'),
      ...(!bothRoles ? [event(2n, FILLER, MAKER, '0x5')] : [])];
    provider.logs = logs;
    provider.receipts.get(raw.transactionHash)!.logs = logs;
    return logs;
  };
  const filterResult = (input: RpcCall, result: unknown) => input.method !== 'eth_getLogs' ? result
    : (result as { topics: string[] }[]).filter(log => (input.params[0] as { topics: (string | null)[] }).topics
      .every((topic, index) => topic === null || log.topics[index] === topic));

  it('reads the complete empty recent Counter window with one canonical lifecycle query', async () => {
    const input = { ...await setup(), fromBlock: DEPLOYMENT_BLOCK, toBlock: SAFE_HEAD };
    const parentAddress = address('66');
    input.provider.versions.set(parentAddress, 'ChainWhisperLinkOTCEscrowV2');
    const parentDeployment = await attestTradeHistoryV2Deployment({ capability: input.capability,
      manifest: { ...MANIFEST, protocol: 'link-v2', contractAddress: parentAddress }, finalityLagBlocks: LAG });
    input.provider.calls.length = 0;
    await readTradeHistoryV2LatestBlockNumber(input.capability);
    for (const topics of filters) await readCanonicalTradeV2RawLogRange({ ...input, topics, participantRange: true });
    await readTradeHistoryV2CanonicalBlock({ capability: input.capability, blockNumber: input.toBlock });
    expect(input.provider.calls).toHaveLength(36);
    input.provider.calls.length = 0;
    const binding = vi.spyOn(ownerCapability, 'getOwnerTradeV2CapabilityBinding').mockReturnValue({
      ownerAddress: MAKER, chainId: CHAIN_ID, signer: {}
    } as never);
    const current = vi.spyOn(ownerCapability, 'assertOwnerTradeV2CapabilityCurrent').mockResolvedValue(undefined);
    try {
      const reader = createCounterTradeV2ActivityReader({ ...input, parentDeployment });
      expect(await reader.sync({} as never)).toMatchObject({ complete: true, throughBlock: '145', orders: [], history: [] });
      expect(input.provider.calls).toHaveLength(21);
      expect(input.provider.calls.filter(call => call.method === 'eth_getLogs')).toHaveLength(1);
      expect(input.provider.calls.filter(call => call.method === 'eth_getCode')).toHaveLength(1);
      console.info('COUNTER_EMPTY_FIRST_SNAPSHOT_RAW_REQUESTS', JSON.stringify({ separate: 36, shared: input.provider.calls.length }));
    } finally { binding.mockRestore(); current.mockRestore(); }
  });

  it('unions both exact indexed roles under one runtime/canonical fence and one shared receipt', async () => {
    const input = await setup({ onRequest: filterResult });
    const logs = fill(input.provider);
    const result = await readCanonicalCounterTradeV2ParticipantRange(input);
    expect(result.logs).toEqual(logs);
    expect(input.provider.calls.filter(call => call.method === 'eth_getLogs').map(call =>
      (call.params[0] as { topics: unknown }).topics)).toEqual(filters);
    expect(input.provider.calls.filter(call => call.method === 'eth_getCode')).toHaveLength(1);
    expect(input.provider.calls.filter(call => call.method === 'eth_getTransactionReceipt')).toHaveLength(1);
    expect(result.receiptLogs[logs[0].transactionHash]).toHaveLength(2);
  });

  it.each(['duplicate', 'conflict', 'off-filter', 'receipt'] as const)('rejects invalid shared results: %s', async failure => {
    let queries = 0;
    const input = await setup({ onRequest: (request, result) => {
      if (request.method !== 'eth_getLogs') return result;
      queries++;
      const filtered = filterResult(request, result) as Record<string, unknown>[];
      if (failure === 'duplicate' && queries === 1) return [...filtered, ...filtered];
      if (failure === 'conflict' && queries === 2) return filtered.map(log => ({ ...log, data: '0x' }));
      if (failure === 'off-filter' && queries === 2) return result;
      return filtered;
    } });
    const logs = fill(input.provider, failure === 'conflict');
    if (failure === 'receipt') input.provider.receipts.get(logs[0].transactionHash)!.logs = [];
    await expect(readCanonicalCounterTradeV2ParticipantRange(input)).rejects.toThrow(/duplicate|conflict|topics|receipt/);
  });

  it('deduplicates an identical physical event across the two filters', async () => {
    const input = await setup({ onRequest: filterResult });
    fill(input.provider, true);
    const result = await readCanonicalCounterTradeV2ParticipantRange(input);
    expect(result.logs).toHaveLength(1);
    expect(input.provider.calls.filter(call => call.method === 'eth_getTransactionReceipt')).toHaveLength(1);
  });

  it.each(['first-filter', 'second-filter', 'session', 'runtime', 'chain', 'reorg'] as const)('publishes no shared page on %s failure', async failure => {
    let enabled = false, retired = false, queries = 0;
    const input = await setup({ assertCurrent: () => { if (retired) throw new Error('Owner session retired.'); },
      onRequest: (request, result, provider) => {
        if (!enabled || request.method !== 'eth_getLogs') return result;
        queries++;
        if (failure === 'first-filter' || failure === 'second-filter' && queries === 2) throw new Error('filter failed');
        if (queries === 2) {
          if (failure === 'session') retired = true;
          if (failure === 'chain') provider.chainId = 1n;
          if (failure === 'reorg') provider.blocks.set('130', { hash: hash('fe'), transactions: [] });
        }
        return result;
      } });
    enabled = true;
    if (failure === 'runtime') input.provider.code = '0x6002';
    await expect(readCanonicalCounterTradeV2ParticipantRange(input)).rejects.toThrow(/eth_getLogs failed|retired|runtime|chain|changed/);
  });

  it.each([1, 2])('retains the per-filter log cap and accepts no page when filter %s is oversized', async oversizedFilter => {
    let queries = 0;
    const input = await setup({ onRequest: (request, result) => request.method === 'eth_getLogs' && ++queries === oversizedFilter
      ? Array.from({ length: 4097 }, () => null) : result });
    await expect(readCanonicalCounterTradeV2ParticipantRange(input)).rejects.toMatchObject({ name: 'TradeHistoryV2RangeLimitError' });
    expect(queries).toBe(oversizedFilter);
  });

  it('rejects a foreign protocol, invalid owner and ranges beyond the existing participant cap before RPC', async () => {
    const input = await setup();
    await expect(readCanonicalCounterTradeV2ParticipantRange({ ...input, ownerAddress: 'invalid' })).rejects.toThrow();
    await expect(readCanonicalCounterTradeV2ParticipantRange({ ...input, toBlock: 100_110n })).rejects.toThrow(/bounded/);
    const standard = await attest();
    await expect(readCanonicalCounterTradeV2ParticipantRange({ ...input, ...standard, deployment: standard.deployment as never })).rejects.toThrow(/Counter/);
    expect(input.provider.calls).toHaveLength(0);
  });
});

describe('tradeHistoryV2Chain', () => {
  it('traces canonical methods and public ranges without changing calls, errors or invalidated output', async () => {
    const attributes = new Map<string, string>(), writes: Record<string, unknown>[] = [];
    const setAttribute = vi.fn((name: string, value: string) => { attributes.set(name, value); writes.push(JSON.parse(value)); });
    vi.stubGlobal('document', { documentElement: { setAttribute,
      getAttribute: (name: string) => attributes.get(name) ?? null,
      removeAttribute: (name: string) => { attributes.delete(name); } } });
    vi.stubEnv('DEV', false); vi.stubEnv('MODE', 'production');
    let held = false, heldGuard = false, current = true, release!: () => void, releaseGuard!: () => void;
    const provider = new ScriptedProvider(), original = provider.request.bind(provider);
    const pendingLogs = new Promise<void>(resolve => { release = resolve; });
    const pendingGuard = new Promise<void>(resolve => { releaseGuard = resolve; });
    provider.request = async request => {
      const result = await original(request);
      if (held && request.method === 'eth_getLogs') await pendingLogs;
      return result;
    };
    const stale = new Error('private-session-error');
    try {
      const capability = await bindTradeHistoryV2ReadCapability({ provider, expectedChainId: CHAIN_ID,
        assertCurrent: async () => { if (!current) throw stale; if (heldGuard) await pendingGuard; },
        isObservationCurrent: () => current });
      const deployment = await attestTradeHistoryV2Deployment({ capability, manifest: MANIFEST, finalityLagBlocks: LAG });
      const input = { capability, deployment, fromBlock: 110n, toBlock: 130n };
      const read = async () => [await readTradeHistoryV2LatestBlockNumber(capability, deployment),
        await readTradeHistoryV2CanonicalBlock({ capability, blockNumber: 110n, observationDeployment: deployment }),
        await readCanonicalTradeHistoryV2LogRange(input),
        await readAttestedTradeHistoryV2View({ capability, deployment, data: METADATA.encodeFunctionData('contractVersion') })];
      provider.calls = [];
      const baseline = await read(), calls = [...provider.calls];
      expect(writes).toHaveLength(0);
      vi.stubEnv('MODE', 'coti-testnet-candidate');
      provider.calls = [];
      expect(await read()).toEqual(baseline);
      expect(provider.calls).toEqual(calls);
      expect(writes.some(value => value.operation === 'head' && value.method === 'eth_chainId')).toBe(true);
      expect(writes.some(value => value.operation === 'block' && value.method === 'eth_getBlockByNumber')).toBe(true);
      expect(writes.some(value => value.operation === 'range' && value.fromBlock === '110' && value.toBlock === '130')).toBe(true);
      for (const value of writes) {
        expect(Object.keys(value).sort()).toEqual(['at', 'attemptStartedAt', 'contractAddress', 'fromBlock', 'method',
          'operation', 'ordinal', 'phase', 'stage', 'state', 'toBlock']);
        expect(value.contractAddress).toBe(CONTRACT);
        expect(JSON.stringify(value)).not.toMatch(/private-session-error|params|calldata|ciphertext|amount|orderId|transactionHash|wallet/);
      }
      setAttribute.mockImplementation(() => { throw Error('observer failed'); });
      provider.calls = [];
      expect(await read()).toEqual(baseline);
      expect(provider.calls).toEqual(calls);
      setAttribute.mockImplementation((name, value) => { attributes.set(name, value); });
      heldGuard = true;
      provider.calls = [];
      const waitingGuard = readTradeHistoryV2LatestBlockNumber(capability, deployment);
      await vi.waitFor(() => expect(JSON.parse(attributes.get('data-p2p-standard-history-read') ?? 'null'))
        .toMatchObject({ operation: 'head', method: 'eth_chainId', phase: 'guard-before', state: 'pending' }));
      expect(provider.calls).toHaveLength(0);
      heldGuard = false; releaseGuard();
      await expect(waitingGuard).resolves.toBe(LATEST.toString());
      held = true;
      const pending = readCanonicalTradeHistoryV2LogRange(input);
      const rejected = expect(pending).rejects.toBe(stale);
      await vi.waitFor(() => expect(JSON.parse(attributes.get('data-p2p-standard-history-read') ?? 'null'))
        .toMatchObject({ stage: 'logs', method: 'eth_getLogs', phase: 'request', state: 'pending', fromBlock: '110', toBlock: '130' }));
      current = false; release(); await rejected;
      expect(attributes.has('data-p2p-standard-history-read')).toBe(false);
    } finally { release(); releaseGuard(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); }
  });

  it('keeps simultaneous Standard, Book and Direct pending methods in separate markers', async () => {
    const attributes = new Map<string, string>();
    vi.stubGlobal('document', { documentElement: {
      setAttribute: (name: string, value: string) => { attributes.set(name, value); },
      getAttribute: (name: string) => attributes.get(name) ?? null,
      removeAttribute: (name: string) => { attributes.delete(name); }
    } });
    vi.stubEnv('DEV', true);
    let hold = false, release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    try {
      const inputs = await Promise.all((['standard-v2', 'private-v2', 'direct-v2'] as const).map(async (protocol, index) => {
        const provider = new ScriptedProvider(), original = provider.request.bind(provider);
        provider.version = protocol === 'standard-v2' ? 'ChainWhisperStandardOTCEscrowV2'
          : protocol === 'private-v2' ? 'ChainWhisperPrivateOTCEscrowV2' : 'ChainWhisperDirectOTCEscrowV2';
        provider.request = async request => { const result = await original(request); if (hold && request.method === 'eth_call') await held; return result; };
        const capability = await bind(provider);
        const deployment = await attestTradeHistoryV2Deployment({ capability,
          manifest: { ...MANIFEST, protocol, contractAddress: address(String(41 + index)) }, finalityLagBlocks: LAG });
        return { capability, deployment, data: METADATA.encodeFunctionData('contractVersion') };
      }));
      hold = true;
      const pending = Promise.all(inputs.map(input => readAttestedTradeHistoryV2View(input)));
      await vi.waitFor(() => {
        for (const [index, protocol] of ['standard', 'private', 'direct'].entries()) {
          expect(JSON.parse(attributes.get(`data-p2p-${protocol}-history-read`) ?? 'null'))
            .toMatchObject({ contractAddress: inputs[index].deployment.contractAddress, operation: 'view',
              method: 'eth_call', state: 'pending', fromBlock: null, toBlock: null });
        }
      });
      release(); await pending;
    } finally { release(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); }
  });

  it.each(['link-v2', 'counter-v2'] as const)('observes only redacted candidate/DEV range and view stages for %s', async protocol => {
    const writes: Array<{ name: string; value: Record<string, unknown> }> = [];
    const setAttribute = vi.fn((name: string, value: string) => {
      writes.push({ name, value: JSON.parse(value) });
    });
    vi.stubGlobal('document', { documentElement: { setAttribute } });
    vi.stubEnv('DEV', false);
    vi.stubEnv('MODE', 'production');
    try {
      const provider = new ScriptedProvider();
      provider.version = protocol === 'link-v2' ? 'ChainWhisperLinkOTCEscrowV2' : 'ChainWhisperCounterOTCEscrowV2';
      const capability = await bind(provider),
        deployment = await attestTradeHistoryV2Deployment({
          capability, manifest: { ...MANIFEST, protocol }, finalityLagBlocks: LAG
        });
      const input = { capability, deployment, fromBlock: 110n, toBlock: 130n, topics: [hash('ab')], participantRange: true };
      const viewInput = { capability, deployment, data: METADATA.encodeFunctionData('contractVersion') };
      provider.calls = [];
      const baseline = await readCanonicalTradeV2RawLogRange(input),
        baselineView = await readAttestedTradeHistoryV2View(viewInput);
      const baselineCalls = [...provider.calls];
      expect(writes).toHaveLength(0);

      vi.stubEnv('MODE', 'coti-testnet-candidate');
      provider.calls = [];
      expect(await readCanonicalTradeV2RawLogRange(input)).toEqual(baseline);
      expect(await readAttestedTradeHistoryV2View(viewInput)).toBe(baselineView);
      expect(provider.calls).toEqual(baselineCalls);
      expect(writes.filter(row => row.value.operation === 'range').map(row => row.value.stage))
        .toEqual(['preflight', 'logs', 'receipts', 'fence', 'done']);
      expect(writes.filter(row => row.value.operation === 'view').map(row => row.value.stage))
        .toEqual(['preflight', 'view', 'fence', 'done']);
      const attribute = protocol === 'link-v2' ? 'data-p2p-link-history-read' : 'data-p2p-counter-history-read';
      expect(writes.every(row => row.name === attribute)).toBe(true);

      provider.logs = [{ privatePayload: 'private-log-value', address: CONTRACT, amount: '123456789', ciphertext: 'private-ciphertext' }];
      await expect(readCanonicalTradeV2RawLogRange(input)).rejects.toThrow();
      expect(writes[writes.length - 1]?.value).toMatchObject({ operation: 'range', stage: 'failed', previousStage: 'receipts' });
      provider.logs = [];
      provider.code = '0x6002';
      await expect(readAttestedTradeHistoryV2View(viewInput)).rejects.toThrow('runtime');
      expect(writes[writes.length - 1]?.value).toMatchObject({ operation: 'view', stage: 'failed', previousStage: 'preflight' });
      for (const { value } of writes) {
        expect(Object.keys(value).sort())
          .toEqual(['at', 'attemptStartedAt', 'operation', 'previousStage', 'previousStageMs', 'stage', 'stageStartedAt']);
        for (const key of ['at', 'attemptStartedAt', 'previousStageMs', 'stageStartedAt'])
          expect(Number.isSafeInteger(value[key])).toBe(true);
        expect(JSON.stringify(value)).not.toMatch(/0x|private|123456789|ciphertext|address/);
      }
      provider.code = CODE;
      setAttribute.mockImplementation(() => { throw Error('DOM observation failed.'); });
      provider.calls = [];
      expect(await readCanonicalTradeV2RawLogRange(input)).toEqual(baseline);
      expect(await readAttestedTradeHistoryV2View(viewInput)).toBe(baselineView);
      expect(provider.calls).toEqual(baselineCalls);

      let stale = false;
      const originalError = Error('private-lease-error');
      const guarded = await bind(provider, () => { if (stale) throw originalError; });
      const guardedDeployment = await attestTradeHistoryV2Deployment({
        capability: guarded, manifest: { ...MANIFEST, protocol }, finalityLagBlocks: LAG
      });
      stale = true;
      await expect(readCanonicalTradeV2RawLogRange({ ...input, capability: guarded, deployment: guardedDeployment }))
        .rejects.toBe(originalError);
      await expect(readAttestedTradeHistoryV2View({ ...viewInput, capability: guarded, deployment: guardedDeployment }))
        .rejects.toBe(originalError);

      const before = writes.length;
      setAttribute.mockImplementation((name, value) => { writes.push({ name, value: JSON.parse(value) }); });
      vi.stubEnv('DEV', true);
      vi.stubEnv('MODE', 'production');
      await readCanonicalTradeV2RawLogRange(input);
      expect(writes.length).toBeGreaterThan(before);
      const after = writes.length;
      await readCanonicalTradeV2RawLogRange({ ...input, participantRange: false });
      expect(writes).toHaveLength(after);
    } finally {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }
  });

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
      c.provider.latest = 85_100n + LAG;
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
    const small = await run(2_048n), large = await run(100_000n);
    expect(large.rows).toEqual(small.rows);
    expect(large.rows).toHaveLength(1);
    expect(large.rows[0]).toMatchObject({ amounts: { offerAmount: '10', requestAmount: '20' } });
    expect(large.pages).toBe(1);
    expect(small.pages).toBe(42);
    expect(large.calls).toBeLessThan(small.calls / 20);
    console.info('P2P_HISTORY_READ_COMPARISON', JSON.stringify({ small: { pages: small.pages, requests: small.calls }, large: { pages: large.pages, requests: large.calls } }));
  });
  it.each(['oversized', 'rpc', 'small-oversized', 'tail-oversized', 'fallback-rpc'] as const)('only narrows a successful oversized canonical History page: %s', async mode => {
    const provider = new ScriptedProvider(); provider.latest = 100_200n;
    if (mode === 'tail-oversized') provider.latest = 200n;
    const request = provider.request.bind(provider);
    let logReads = 0;
    provider.request = async args => {
      if (args.method === 'eth_getLogs') {
        logReads++;
        if (mode === 'rpc' || mode === 'fallback-rpc' && logReads === 2) throw new Error('external RPC stopped');
        if (mode === 'small-oversized' || mode === 'tail-oversized' || logReads === 1) {
          provider.calls.push({ method: args.method, params: [...args.params ?? []] });
          return Array.from({ length: 4097 }, () => null);
        }
      }
      return request(args);
    };
    const capability = await bind(provider);
    const deployment = await attestTradeHistoryV2Deployment({ capability, manifest: MANIFEST, finalityLagBlocks: LAG });
    const previous = { sync: createTradeHistoryV2SyncState(createTradeHistoryV2LedgerState()), materialization: createTradeHistoryV2MaterializationState() };
    const run = syncTradeHistoryV2PipelineRange({ previous,
      scope: { chainId: deployment.chainId, contractAddress: deployment.contractAddress, deploymentBlock: deployment.deploymentBlock },
      capability, deployment, confirmationDepth: LAG, maxBlockSpan: mode === 'small-oversized' ? 2048n : 100_000n,
      overlapBlocks: 16n, viewer: FILLER, expectedLedgerRevision: 0, expectedMaterializationRevision: 0,
      reads: { getLatestBlockNumber: () => readTradeHistoryV2LatestBlockNumber(capability),
        readCanonicalBlock: (_chain, number) => readTradeHistoryV2CanonicalBlock({ capability, blockNumber: BigInt(number) }) } });
    if (mode === 'oversized') {
      const result = await run;
      expect(result).toMatchObject({ narrowedForLogLimit: true, hasMore: true, page: { fromBlock: '100', toBlock: '2147' } });
      expect(logReads).toBe(2);
    } else {
      await expect(run).rejects.toThrow(mode === 'rpc' || mode === 'fallback-rpc' ? /RPC.*failed/ : /log.*limit|too many|oversized/i);
      expect(logReads).toBe(mode === 'fallback-rpc' ? 2 : 1);
    }
    expect(previous.sync.checkpointsByScope).toEqual({});
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
      capability: context.capability, deployment: context.deployment, fromBlock: 100n, toBlock: 100_100n
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

