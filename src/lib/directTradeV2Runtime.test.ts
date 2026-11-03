import { Interface, keccak256, toUtf8Bytes } from '@coti-io/coti-ethers';
import { describe, expect, it, vi } from 'vitest';
import type { ChatMessage } from './appShared/core';
import { DIRECT_TRADE_V2_ACTION_ABI } from './directTradeV2Actions';
import type { DirectTradeV2ChatEntry } from './directTradeV2ChatProjection';
import {
  assertDirectTradeV2Runtime,
  createDirectTradeV2Runtime,
  listCanonicalIncomingDirectTradeV2Openings,
  listNewIncomingDirectTradeV2Openings,
  reconcileDirectTradeV2ChatMessages,
  resolveDirectTradeV2RuntimeReference
} from './directTradeV2Runtime';

const address = (pair: string): string => `0x${pair.repeat(20)}`;
const hash = (pair: string): string => `0x${pair.repeat(32)}`;
const CONTRACT = address('11');
const VIEWER = address('22');
const PEER = address('33');
const TOKEN_A = address('66');
const TOKEN_B = address('77');
const CODE = '0x6001600055';
const CHAIN_ID = 7_082_400n;
const ACTIONS = new Interface(DIRECT_TRADE_V2_ACTION_ABI);
const METADATA = new Interface([
  'function contractVersion() view returns (string)',
  'function supportsFeature(bytes32 feature) view returns (bool)'
]);
const APP_WALLET_FEATURE = keccak256(toUtf8Bytes('APP_WALLET_EXECUTOR')).toLowerCase();
const quantity = (value: bigint): string => `0x${value.toString(16)}`;
const blockHash = (value: bigint): string => `0x${value.toString(16).padStart(64, '0')}`;

const notificationRuntime = async () => {
  let latestBlock = 10_005n;
  const logs: Array<Record<string, unknown>> = [];
  const receipts = new Map<string, Record<string, unknown>>();
  const hashes = new Map<bigint, string>();
  const addOpening = (tradeId: bigint, blockNumber: bigint) => {
    const transactionHash = blockHash(tradeId + 1_000_000n);
    const encoded = ACTIONS.encodeEventLog(ACTIONS.getEvent('DirectTradeOpened')!, [tradeId, PEER, VIEWER,
      address('00'), 0n, tradeId, 0n, 1n, TOKEN_A, 1n, TOKEN_B, 0n, 10n, 25n,
      1_700_000_000n + blockNumber, 1_800_000_000n]);
    const log = { ...encoded, address: CONTRACT, blockNumber: quantity(blockNumber),
      blockHash: hashes.get(blockNumber) ?? blockHash(blockNumber), transactionHash,
      transactionIndex: '0x0', logIndex: '0x0', removed: false };
    logs.push(log);
    receipts.set(transactionHash, { status: '0x1', blockNumber: log.blockNumber, blockHash: log.blockHash,
      transactionHash, transactionIndex: '0x0', logs: [{ ...log, removed: undefined }] });
    return log;
  };
  const getOwnerCapability = vi.fn(async () => { throw new Error('Read-only notifications must not acquire a signer.'); });
  const provider = { request: vi.fn(async ({ method, params = [] }: { method: string; params?: readonly unknown[] }) => {
    if (method === 'eth_chainId') return quantity(CHAIN_ID);
    if (method === 'eth_blockNumber') return quantity(latestBlock);
    if (method === 'eth_getCode') return CODE;
    if (method === 'eth_getLogs') {
      const range = params[0] as { fromBlock: string; toBlock: string };
      return logs.filter(log => BigInt(String(log.blockNumber)) >= BigInt(range.fromBlock) &&
        BigInt(String(log.blockNumber)) <= BigInt(range.toBlock));
    }
    if (method === 'eth_getTransactionReceipt') return receipts.get(String(params[0])) ?? null;
    if (method === 'eth_getBlockByNumber') {
      const number = BigInt(String(params[0]));
      return { number: quantity(number), hash: hashes.get(number) ?? blockHash(number),
        transactions: logs.filter(log => BigInt(String(log.blockNumber)) === number).map(log => log.transactionHash) };
    }
    if (method === 'eth_call') {
      const parsed = METADATA.parseTransaction(params[0] as { data: string });
      if (!parsed) throw new Error('Unknown getter.');
      return METADATA.encodeFunctionResult(parsed.name, [parsed.name === 'contractVersion'
        ? 'ChainWhisperDirectOTCEscrowV2' : String(parsed.args[0]).toLowerCase() !== APP_WALLET_FEATURE]);
    }
    throw new Error(`Unexpected RPC ${method}.`);
  }) };
  const runtime = await createDirectTradeV2Runtime({ config: { status: 'active', manifest: {
    protocol: 'direct-v2', chainId: CHAIN_ID.toString(), contractAddress: CONTRACT,
    deploymentBlock: '100', runtimeBytecodeHash: keccak256(CODE)
  }, finalityLagBlocks: 5n, rpcUrl: 'https://example.invalid/', fingerprint: 'recent-notifications' },
    ownerAddress: VIEWER, provider, assertCurrent: () => undefined, getOwnerCapability,
    runOwnerTransactionFlow: async operation => operation() });
  return { runtime, provider, addOpening, receipts, hashes, getOwnerCapability,
    setHead: (head: bigint) => { latestBlock = head; },
    ranges: () => provider.request.mock.calls.filter(([request]) => request.method === 'eth_getLogs')
      .map(([request]) => request.params?.[0] as { address: string; fromBlock: string; toBlock: string }) };
};

describe('directTradeV2Runtime recent notification polling', () => {
  it('reads one current window, suppresses initial alerts and reaches new events without draining its archive', async () => {
    const source = await notificationRuntime();
    source.addOpening(1n, 105n);
    source.addOpening(2n, 9_999n);
    const first = await source.runtime.sync();
    expect(source.ranges().map(range => [BigInt(range.fromBlock), BigInt(range.toBlock)])).toEqual([[9_489n, 10_000n]]);
    expect(first).toMatchObject({ hasMore: false, historyComplete: false, newIncomingOpenings: [], incomingContacts: [] });
    expect(first.canonicalIncomingOpenings.map(entry => entry.message.directTradeV2?.tradeId)).toEqual(['2']);
    const normal: ChatMessage = { id: 'regular', direction: 'incoming', text: 'Preserve normal chat.' };
    const applied = first.apply({ [PEER]: [normal] });
    expect(applied[PEER]).toContainEqual(normal);
    expect(applied[PEER]).toHaveLength(2);
    await source.runtime.sync();
    expect(source.ranges()).toHaveLength(1);
    source.setHead(10_007n);
    source.addOpening(3n, 10_001n);
    const next = await source.runtime.sync();
    expect(next.newIncomingOpenings.map(entry => entry.message.directTradeV2?.tradeId)).toEqual(['3']);
    expect(next.historyComplete).toBe(false);
    expect(source.ranges().map(range => [BigInt(range.fromBlock), BigInt(range.toBlock)])).toEqual([
      [9_489n, 10_000n], [9_491n, 10_002n]
    ]);
    source.hashes.set(10_002n, hash('99'));
    expect(await source.runtime.sync()).toMatchObject({ reorged: true, newIncomingOpenings: [], hasMore: false });
    expect(source.ranges().every(range => range.address.toLowerCase() === CONTRACT && BigInt(range.fromBlock) >= 9_489n)).toBe(true);
    expect(source.getOwnerCapability).not.toHaveBeenCalled();
    source.runtime.close();
  });

  it('keeps receipt checks and does not consume an unverified recent page', async () => {
    const source = await notificationRuntime();
    const log = source.addOpening(2n, 9_999n);
    const receipt = source.receipts.get(log.transactionHash)!;
    source.receipts.set(log.transactionHash, { ...receipt, blockHash: hash('98') });
    await expect(source.runtime.sync()).rejects.toThrow(/receipt|canonical|block hash/i);
    source.receipts.set(log.transactionHash, receipt);
    const result = await source.runtime.sync();
    expect(source.ranges()[0]).toEqual(source.ranges()[1]);
    expect(result.canonicalIncomingOpenings).toHaveLength(1);
    expect(result.newIncomingOpenings).toEqual([]);
    source.runtime.close();
  });

  it('does not alert for a fresh recent baseline after a long idle gap', async () => {
    const source = await notificationRuntime();
    await source.runtime.sync();
    source.setHead(20_005n);
    source.addOpening(4n, 19_999n);
    const result = await source.runtime.sync();
    expect(result.canonicalIncomingOpenings).toHaveLength(1);
    expect(result.newIncomingOpenings).toEqual([]);
    expect(source.ranges().map(range => [BigInt(range.fromBlock), BigInt(range.toBlock)])).toEqual([
      [9_489n, 10_000n], [19_489n, 20_000n]
    ]);
    source.runtime.close();
  });
});

const projected = (
  id: string,
  blockNumber: number,
  options: Readonly<{
    direction?: 'incoming' | 'outgoing';
    eventKind?: 'opened' | 'status';
    relatedTradeId?: string;
  }> = {}
): DirectTradeV2ChatEntry => Object.freeze({
  viewer: VIEWER,
  contact: PEER,
  message: Object.freeze({
    id,
    direction: options.direction ?? 'incoming',
    text: `trade-${id}`,
    senderAddress: PEER,
    isSystem: true,
    timestamp: blockNumber,
    blockNumber,
    logIndex: 1,
    txHash: hash('44'),
    deliveryState: 'sent',
    directTradeV2: Object.freeze({
      protocol: 'direct-trade-v2',
      eventKind: options.eventKind ?? 'opened',
      chainId: '7',
      contractAddress: CONTRACT,
      tradeId: '1',
      relatedTradeId: options.relatedTradeId ?? '0',
      transactionHash: hash('44'),
      blockNumber: blockNumber.toString(),
      blockHash: hash('55'),
      logIndex: 1,
      finality: 'finalized'
    })
  })
});

describe('directTradeV2Runtime notification selection', () => {
  it('selects only new incoming direct trades and counters', () => {
    const direct = projected('direct', 1);
    const counter = projected('counter', 2, { relatedTradeId: '9' });
    const status = projected('status', 3, { eventKind: 'status' });
    const outgoing = projected('outgoing', 4, { direction: 'outgoing' });
    const alreadySeen = projected('seen', 5);

    expect(listNewIncomingDirectTradeV2Openings({
      entries: [direct, counter, status, outgoing, alreadySeen],
      previousIds: new Set(['seen']),
      replacementTradeIds: new Set(),
      enabled: true
    })).toEqual([direct, counter]);
  });

  it('does not alert when a replacement emits another opening for the recipient', () => {
    const replacement = projected('replacement', 6);
    expect(listCanonicalIncomingDirectTradeV2Openings({
      entries: [replacement],
      replacementTradeIds: new Set(['1'])
    })).toEqual([]);
    expect(listNewIncomingDirectTradeV2Openings({
      entries: [replacement],
      previousIds: new Set(),
      replacementTradeIds: new Set(['1']),
      enabled: true
    })).toEqual([]);
  });

  it('does not create historical or reorg alerts while discovery is disabled', () => {
    expect(listNewIncomingDirectTradeV2Openings({
      entries: [projected('direct', 1), projected('counter', 2, { relatedTradeId: '1' })],
      previousIds: new Set(),
      replacementTradeIds: new Set(),
      enabled: false
    })).toEqual([]);
  });
});

describe('directTradeV2Runtime projection reconciliation', () => {
  it('replaces only the exact Direct V2 scope and preserves normal and legacy messages', () => {
    const normal: ChatMessage = {
      id: 'normal', direction: 'incoming', text: 'hello', timestamp: 1
    };
    const orphan = projected('orphan', 2).message;
    const result = reconcileDirectTradeV2ChatMessages({
      previous: { [PEER]: [normal, orphan] },
      entries: [projected('canonical', 3)],
      chainId: '7',
      contractAddress: CONTRACT,
      viewerAddress: VIEWER
    });
    expect(result[PEER]).toEqual([normal, projected('canonical', 3).message]);
  });

  it('rejects a projection from another viewer or deployment', () => {
    expect(() => reconcileDirectTradeV2ChatMessages({
      previous: {},
      entries: [{ ...projected('wrong', 3), viewer: address('99') }],
      chainId: '7',
      contractAddress: CONTRACT,
      viewerAddress: VIEWER
    })).toThrow(/another runtime scope/i);
  });

  it('rejects structural runtime lookalikes', () => {
    expect(() => assertDirectTradeV2Runtime({} as never)).toThrow(/verified factory/i);
  });
});

describe('directTradeV2Runtime public card hydration', () => {
  it('enforces Direct policy and closes queued owner requests before wallet access', async () => {
    const provider = { request: vi.fn(async ({ method, params = [] }: { method: string; params?: readonly unknown[] }) => {
      if (method === 'eth_chainId') return quantity(CHAIN_ID);
      if (method === 'eth_blockNumber') return quantity(130n);
      if (method === 'eth_getBlockByNumber') { const number = BigInt(String(params[0])); return { number: quantity(number), hash: blockHash(number), transactions: [] }; }
      if (method === 'eth_getCode') return CODE;
      if (method === 'eth_call') {
        const parsed = METADATA.parseTransaction(params[0] as { data: string });
        if (!parsed) throw new Error('Unknown getter');
        return METADATA.encodeFunctionResult(parsed.name, [parsed.name === 'contractVersion' ? 'ChainWhisperDirectOTCEscrowV2' : String(parsed.args[0]).toLowerCase() !== APP_WALLET_FEATURE]);
      }
      throw new Error(`Unexpected RPC ${method}`);
    }) };
    const getOwnerCapability = vi.fn(async () => ({} as never));
    let release!: () => void, entered!: () => void;
    const queued = new Promise<void>(resolve => { entered = resolve; });
    const runtime = await createDirectTradeV2Runtime({ config: { status: 'active', manifest: {
      protocol: 'direct-v2', chainId: CHAIN_ID.toString(), contractAddress: CONTRACT, deploymentBlock: '100', runtimeBytecodeHash: keccak256(CODE)
    }, finalityLagBlocks: 5n, rpcUrl: 'https://example.invalid/', fingerprint: 'queued-direct', actionAdmission: {
      chainId: CHAIN_ID.toString(), contractAddress: CONTRACT, runtimeBytecodeHash: keccak256(CODE), mode: 'held'
    } }, ownerAddress: VIEWER,
    provider, assertCurrent: () => undefined, getOwnerCapability,
    runOwnerTransactionFlow: <T,>(operation: () => Promise<T>) => new Promise<T>((resolve, reject) => {
      release = () => { void operation().then(resolve, reject); }; entered();
    }) });
    await expect(runtime.execute({ kind: 'create-private', offerToken: TOKEN_A, requestToken: TOKEN_B,
      offerAmount: 10n, requestAmount: 25n, taker: PEER, expiresAt: 1_800_000_000n })).rejects.toThrow(/activation/);
    expect(getOwnerCapability).not.toHaveBeenCalled();
    const pending = runtime.execute({ kind: 'cancel', tradeId: 1n });
    await queued; runtime.close();
    const result = expect(pending).rejects.toThrow(/closed/); release(); await result;
    expect(getOwnerCapability).not.toHaveBeenCalled();
  });

  it('does not acquire an owner signer capability for public trade terms', async () => {
    const retainedContract = address('88');
    const provider = {
      request: vi.fn(async ({ method, params = [] }: { method: string; params?: readonly unknown[] }) => {
        if (method === 'eth_chainId') return quantity(CHAIN_ID);
        if (method === 'eth_blockNumber') return quantity(130n);
        if (method === 'eth_getBlockByNumber') {
          const number = BigInt(String(params[0]));
          return { number: quantity(number), hash: blockHash(number), transactions: [] };
        }
        if (method === 'eth_getCode') return CODE;
        if (method === 'eth_getLogs') {
          return [];
        }
        if (method === 'eth_call') {
          const data = (params[0] as { data: string }).data;
          if (data.slice(0, 10).toLowerCase() === ACTIONS.getFunction('getTradeView')?.selector.toLowerCase()) {
            return ACTIONS.encodeFunctionResult('getTradeView', [[
              [
                VIEWER, PEER, 1n, 0n,
                [1n, TOKEN_A], [1n, TOKEN_B],
                1_700_000_000n, 0n,
                0n, 7n, 0n, true, hash('12'), hash('13')
              ],
              [10n, 25n],
              1n, 0n, 0n, 0n
            ]]);
          }
          const parsed = METADATA.parseTransaction({ data });
          if (!parsed) throw new Error('Unknown getter.');
          return parsed.name === 'contractVersion'
            ? METADATA.encodeFunctionResult(parsed.name, ['ChainWhisperDirectOTCEscrowV2'])
            : METADATA.encodeFunctionResult(parsed.name, [
                String(parsed.args[0]).toLowerCase() !== APP_WALLET_FEATURE
              ]);
        }
        throw new Error(`Unexpected RPC ${method}.`);
      })
    };
    const getOwnerCapability = vi.fn(async () => {
      throw new Error('The wallet capability must remain untouched.');
    });
    const runtime = await createDirectTradeV2Runtime({
      config: {
        status: 'active',
        manifest: {
          protocol: 'direct-v2',
          chainId: CHAIN_ID.toString(),
          contractAddress: CONTRACT,
          deploymentBlock: '100',
          runtimeBytecodeHash: keccak256(CODE)
        },
        finalityLagBlocks: 5n,
        rpcUrl: 'https://example.invalid/',
        fingerprint: 'test-direct-trade-v2'
      },
      ownerAddress: VIEWER,
      provider,
      assertCurrent: () => undefined,
      getOwnerCapability,
      runOwnerTransactionFlow: async (operation) => operation()
    });

    await expect(runtime.readTradeTerms(7n, { decryptPrivateAmounts: false })).resolves.toMatchObject({
      tradeId: '7',
      maker: VIEWER,
      taker: PEER,
      amountMode: 'public',
      offerAmount: '10',
      requestAmount: '25'
    });
    expect(getOwnerCapability).not.toHaveBeenCalled();
    await expect(resolveDirectTradeV2RuntimeReference(runtime, {
      chainId: CHAIN_ID.toString(), contractAddress: CONTRACT, orderId: '7'
    })).resolves.toBe(runtime);
    for (const reference of [
      { chainId: CHAIN_ID.toString(), contractAddress: retainedContract, orderId: '7' },
      { chainId: '1', contractAddress: CONTRACT, orderId: '7' },
      { chainId: CHAIN_ID.toString(), contractAddress: CONTRACT, orderId: '0' },
      { chainId: CHAIN_ID.toString(), contractAddress: CONTRACT, orderId: (1n << 256n).toString() }
    ]) {
      await expect(resolveDirectTradeV2RuntimeReference(runtime, reference)).rejects.toThrow(/reference/);
    }
    expect(await runtime.sync()).toMatchObject({ hasMore: false, historyComplete: true });
    const logCalls = provider.request.mock.calls.filter(([value]) => value.method === 'eth_getLogs');
    expect(logCalls.length).toBeGreaterThan(0);
    for (const [value] of logCalls) expect((value.params?.[0] as { address: string }).address.toLowerCase()).toBe(CONTRACT);
    expect(getOwnerCapability).not.toHaveBeenCalled();
    runtime.close();
    expect(runtime.isCurrent()).toBe(false);
    await expect(runtime.readTradeTerms(7n)).rejects.toThrow(/closed/);
    await expect(resolveDirectTradeV2RuntimeReference(runtime, {
      chainId: CHAIN_ID.toString(), contractAddress: CONTRACT, orderId: '7'
    })).rejects.toThrow(/Reconnect/);
  });
});
