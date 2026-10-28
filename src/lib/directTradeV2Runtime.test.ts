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
  reconcileDirectTradeV2ChatMessages
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
    let failRetained = true;
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
          const filter = params[0] as { address: string };
          if (filter.address.toLowerCase() === retainedContract && failRetained) { failRetained = false; throw new Error('retained scope unavailable'); }
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
        fingerprint: 'test-direct-trade-v2',
        retainedManifests: [{ protocol: 'direct-v2', chainId: CHAIN_ID.toString(), contractAddress: retainedContract, deploymentBlock: '90', runtimeBytecodeHash: keccak256(CODE) }]
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
    const old = await runtime.forReference!({ chainId: CHAIN_ID.toString(), contractAddress: retainedContract, orderId: '7' });
    expect(old.contractAddress).toBe(retainedContract);
    await expect(old.readTradeTerms(7n, { decryptPrivateAmounts: false })).resolves.toMatchObject({ tradeId: '7', offerAmount: '10' });
    expect(getOwnerCapability).not.toHaveBeenCalled();
    await expect(runtime.forReference!({ chainId: '1', contractAddress: retainedContract, orderId: '7' })).rejects.toThrow(/reference/);
    await expect(runtime.forReference!({ chainId: CHAIN_ID.toString(), contractAddress: address('99'), orderId: '7' })).rejects.toThrow(/reference/);
    await expect(runtime.sync()).rejects.toThrow();
    const callsBefore = provider.request.mock.calls.filter(([value]) => value.method === 'eth_getLogs');
    await runtime.sync();
    const callsAfter = provider.request.mock.calls.filter(([value]) => value.method === 'eth_getLogs');
    const currentRanges = callsAfter.filter(([value]) => (value.params?.[0] as { address?: string })?.address?.toLowerCase() === CONTRACT);
    expect(callsAfter.length).toBe(callsBefore.length + 2);
    expect((currentRanges[0][0].params?.[0] as { fromBlock: string }).fromBlock).toBe((currentRanges[1][0].params?.[0] as { fromBlock: string }).fromBlock);
    runtime.close();
    expect(old.isCurrent()).toBe(false);
    await expect(old.readTradeTerms(7n)).rejects.toThrow(/closed/);
  });
});
