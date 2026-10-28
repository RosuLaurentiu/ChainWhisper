import {
  BrowserProvider,
  Interface,
  keccak256,
  toUtf8Bytes,
  type JsonRpcSigner
} from '@coti-io/coti-ethers';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  ensureTradeTokenAllowance: vi.fn(),
  loadCotiEthersModule: vi.fn()
}));

vi.mock('./appChain', () => ({ ensureTradeTokenAllowance: mocks.ensureTradeTokenAllowance }));
vi.mock('./appShared/core', async (importOriginal) => ({
  ...await importOriginal<typeof import('./appShared/core')>(),
  loadCotiEthersModule: mocks.loadCotiEthersModule
}));

import {
  STANDARD_TRADE_V2_ACTION_ABI,
  confirmStandardTradeV2Action,
  ensureStandardTradeV2Allowance,
  quoteStandardTradeV2Fill,
  readStandardTradeV2Ids,
  readStandardTradeV2View,
  submitStandardTradeV2Action
} from './standardTradeV2Actions';
import {
  assertOwnerTradeV2CapabilityCurrent,
  bindOwnerTradeV2MetaMaskCapability
} from './ownerTradeV2Capability';
import { attestTradeHistoryV2Deployment, bindTradeHistoryV2ReadCapability } from './tradeHistoryV2Chain';

const address = (pair: string): string => `0x${pair.repeat(20)}`;
const hash = (pair: string): string => `0x${pair.repeat(32)}`;
const quantity = (value: bigint): string => `0x${value.toString(16)}`;
const blockHash = (number: bigint): string => `0x${number.toString(16).padStart(64, '0')}`;
const CHAIN_ID = 7_082_400n;
const CONTRACT = address('11');
const OWNER = address('22');
const TOKEN_A = address('33');
const TOKEN_B = address('44');
const CODE = '0x6001600055';
const TX_HASH = hash('aa');
const ABI = new Interface(STANDARD_TRADE_V2_ACTION_ABI);
const METADATA = new Interface([
  'function contractVersion() view returns (string)',
  'function supportsFeature(bytes32 feature) view returns (bool)'
]);
const APP_WALLET = keccak256(toUtf8Bytes('APP_WALLET_EXECUTOR')).toLowerCase();

class AttestationProvider {
  async request({ method, params = [] }: { method: string; params?: readonly unknown[] }): Promise<unknown> {
    if (method === 'eth_chainId') return quantity(CHAIN_ID);
    if (method === 'eth_blockNumber') return quantity(130n);
    if (method === 'eth_getBlockByNumber') {
      const number = BigInt(String(params[0]));
      return { number: quantity(number), hash: blockHash(number), transactions: [] };
    }
    if (method === 'eth_getCode') return CODE;
    if (method === 'eth_call') {
      const parsed = METADATA.parseTransaction({ data: (params[0] as { data: string }).data });
      if (!parsed) throw new Error('Unknown getter.');
      return parsed.name === 'contractVersion'
        ? METADATA.encodeFunctionResult(parsed.name, ['ChainWhisperStandardOTCEscrowV2'])
        : METADATA.encodeFunctionResult(parsed.name, [String(parsed.args[0]).toLowerCase() !== APP_WALLET]);
    }
    throw new Error(`Unexpected RPC ${method}.`);
  }
}

const setup = async () => {
  const readCapability = await bindTradeHistoryV2ReadCapability({
    provider: new AttestationProvider(), expectedChainId: CHAIN_ID, assertCurrent: () => undefined
  });
  const deployment = await attestTradeHistoryV2Deployment({
    capability: readCapability,
    manifest: {
      protocol: 'standard-v2', chainId: CHAIN_ID, contractAddress: CONTRACT,
      deploymentBlock: 100n, runtimeBytecodeHash: keccak256(CODE)
    },
    finalityLagBlocks: 5n
  });
  const provider = new BrowserProvider({
    request: vi.fn(async ({ method }: { method: string }) => {
      if (method === 'eth_chainId') return quantity(CHAIN_ID);
      if (method === 'eth_accounts') return [OWNER];
      return null;
    })
  }, { chainId: Number(CHAIN_ID), name: 'Standard OTC V2 test' });
  const signer = {
    provider,
    getAddress: vi.fn(async () => OWNER),
    sendUncheckedTransaction: vi.fn(),
    getUserOnboardInfo: vi.fn(() => ({}))
  } as unknown as JsonRpcSigner;
  const assertCurrent = vi.fn(() => undefined);
  const assertSnapshotCurrent = vi.fn(() => undefined);
  const capability = await bindOwnerTradeV2MetaMaskCapability({
    signer, browserProvider: provider, ownerAddress: OWNER, chainId: CHAIN_ID,
    assertCurrent,
    assertSnapshotCurrent
  });
  return { assertCurrent, assertSnapshotCurrent, capability, deployment, signer };
};

describe('standardTradeV2Actions', () => {
  beforeEach(() => vi.clearAllMocks());

  it('attests the owner scope once, then uses one live lease check per currentness fence', async () => {
    const context = await setup();
    expect(context.assertSnapshotCurrent).toHaveBeenCalledTimes(1);
    expect(context.assertCurrent).not.toHaveBeenCalled();
    await assertOwnerTradeV2CapabilityCurrent(context.capability);
    expect(context.assertCurrent).toHaveBeenCalledTimes(1);
  });

  it('reads the exact current fill revision and quote for the connected filler', async () => {
    const context = await setup();
    const getTradeView = vi.fn(async () => ({
      trade: {
        maker: address('55'), status: 1n,
        offerAsset: { assetType: 1n, token: TOKEN_A, amount: 100n },
        requestAsset: { assetType: 1n, token: TOKEN_B, amount: 200n },
        fillPolicy: {
          partialFillsAllowed: true, minPartialFillBps: 1000n, minRequestAmount: 10n,
          maxRequestAmountPerWallet: 100n, oneFillPerWallet: false
        },
        createdAt: 1n, expiresAt: 0n, rootTradeId: 7n
      },
      fillState: {
        remainingOfferAmount: 80n, remainingRequestAmount: 160n,
        filledOfferAmount: 20n, filledRequestAmount: 40n, revision: 2n
      },
      effectiveStatus: 1n, replacementTradeId: 0n, replacesTradeId: 0n
    }));
    const quoteFillFor = vi.fn(async () => ({
      revision: 2n, requestAmountIn: 20n, offerAmountOut: 10n, isFinalFill: false,
      remainingOfferAmountAfter: 70n, remainingRequestAmountAfter: 140n
    }));
    mocks.loadCotiEthersModule.mockResolvedValue({
      Contract: vi.fn(function MockContract() { return { getTradeView, quoteFillFor }; })
    });
    await expect(readStandardTradeV2View({ ...context, tradeId: 7n })).resolves.toMatchObject({
      tradeId: '7', status: 'open', revision: '2', filledOfferAmount: '20', filledRequestAmount: '40'
    });
    await expect(quoteStandardTradeV2Fill({ ...context, tradeId: 7n, requestAmountIn: 20n }))
      .resolves.toMatchObject({ revision: '2', requestAmountIn: '20', offerAmountOut: '10' });
    expect(quoteFillFor).toHaveBeenCalledWith(7n, OWNER, 20n);
  });

  it('reads bounded maker and open discovery pages without private prompts', async () => {
    const context = await setup();
    const getTradeIdsForMaker = vi.fn(async () => ({ ids: [9n, 7n], nextOffset: 2n }));
    const getOpenTradeIds = vi.fn(async () => [[12n, 11n], 4n]);
    mocks.loadCotiEthersModule.mockResolvedValue({
      Contract: vi.fn(function MockContract() { return { getTradeIdsForMaker, getOpenTradeIds }; })
    });

    await expect(readStandardTradeV2Ids({
      ...context, scope: 'maker', offset: 0n, limit: 25n
    })).resolves.toEqual({ tradeIds: ['9', '7'], nextOffset: '2' });
    await expect(readStandardTradeV2Ids({
      ...context, scope: 'open', offset: 2n, limit: 10n
    })).resolves.toEqual({ tradeIds: ['12', '11'], nextOffset: '4' });
    expect(getTradeIdsForMaker).toHaveBeenCalledWith(OWNER.toLowerCase(), 0n, 25n);
    expect(getOpenTradeIds).toHaveBeenCalledWith(2n, 10n);
  });

  it('uses one allowance and one exact create transaction, then binds the opened receipt', async () => {
    const context = await setup();
    const action = {
      kind: 'create' as const,
      offerAsset: { assetType: 'erc20' as const, token: TOKEN_A, amount: 100n },
      requestAsset: { assetType: 'erc20' as const, token: TOKEN_B, amount: 200n },
      fillPolicy: {
        partialFillsAllowed: true, minPartialFillBps: 1000n,
        minRequestAmount: 10n, maxRequestAmountPerWallet: 100n, oneFillPerWallet: false
      },
      expiresAt: 0n
    };
    await ensureStandardTradeV2Allowance({ ...context, action });
    expect(mocks.ensureTradeTokenAllowance).toHaveBeenCalledWith(
      expect.anything(), OWNER, TOKEN_A, 100n, 'erc20', CONTRACT
    );

    const event = ABI.getEvent('StandardTradeOpened');
    if (!event) throw new Error('event missing');
    const encoded = ABI.encodeEventLog(event, [
      7n, OWNER, hash('bb'), 1n, TOKEN_A, 100n, 1n, TOKEN_B, 200n,
      [true, 1000n, 10n, 100n, false], 1n, 0n, 1n, 7n
    ]);
    const write = vi.fn(async (...args: unknown[]) => {
      const last = args[args.length - 1];
      if (last && typeof last === 'object' && 'value' in last) args.pop();
      const data = ABI.encodeFunctionData('createTrade', args).toLowerCase();
      const log = {
        address: CONTRACT, topics: encoded.topics, data: encoded.data,
        blockNumber: 120n, blockHash: blockHash(120n), transactionHash: TX_HASH,
        logIndex: 2n, removed: false
      };
      return {
        hash: TX_HASH, chainId: CHAIN_ID, from: OWNER, to: CONTRACT, data, value: 0n,
        wait: vi.fn(async () => ({
          status: 1n, hash: TX_HASH, blockNumber: 120n, blockHash: blockHash(120n), logs: [log]
        }))
      };
    });
    mocks.loadCotiEthersModule.mockResolvedValue({
      Contract: vi.fn(function MockContract() { return { createTrade: write }; })
    });
    const submission = await submitStandardTradeV2Action({ ...context, action });
    const liveChecksBeforeConfirmation = context.assertCurrent.mock.calls.length;
    const snapshotChecksBeforeConfirmation = context.assertSnapshotCurrent.mock.calls.length;
    context.assertCurrent.mockImplementation(() => {
      throw new Error('Owner wallet session changed after broadcast.');
    });
    await expect(confirmStandardTradeV2Action(submission)).resolves.toMatchObject({
      action: 'create', tradeId: '7', transactionHash: TX_HASH, logIndex: 2
    });
    expect(write).toHaveBeenCalledTimes(1);
    expect(context.assertCurrent).toHaveBeenCalledTimes(liveChecksBeforeConfirmation);
    expect(context.assertSnapshotCurrent).toHaveBeenCalledTimes(snapshotChecksBeforeConfirmation);
  });

  it('binds a non-cancelled wallet replacement to the effective hash and exact opened log', async () => {
    const context = await setup();
    const replacementHash = hash('cc');
    const action = {
      kind: 'create' as const,
      offerAsset: { assetType: 'erc20' as const, token: TOKEN_A, amount: 100n },
      requestAsset: { assetType: 'erc20' as const, token: TOKEN_B, amount: 200n },
      fillPolicy: {
        partialFillsAllowed: false, minPartialFillBps: 0n,
        minRequestAmount: 0n, maxRequestAmountPerWallet: 0n, oneFillPerWallet: false
      },
      expiresAt: 0n
    };
    const event = ABI.getEvent('StandardTradeOpened');
    if (!event) throw new Error('event missing');
    const encoded = ABI.encodeEventLog(event, [
      8n, OWNER, hash('bc'), 1n, TOKEN_A, 100n, 1n, TOKEN_B, 200n,
      [false, 0n, 0n, 0n, false], 1n, 0n, 1n, 8n
    ]);
    const write = vi.fn(async (...args: unknown[]) => {
      const last = args[args.length - 1];
      if (last && typeof last === 'object' && 'value' in last) args.pop();
      const data = ABI.encodeFunctionData('createTrade', args).toLowerCase();
      const replacement = {
        hash: replacementHash, chainId: CHAIN_ID, from: OWNER, to: CONTRACT, data, value: 0n,
        wait: vi.fn()
      };
      const receipt = {
        status: 1n, hash: replacementHash, blockNumber: 121n, blockHash: blockHash(121n),
        logs: [{
          address: CONTRACT, topics: encoded.topics, data: encoded.data,
          blockNumber: 121n, blockHash: blockHash(121n), transactionHash: replacementHash,
          logIndex: 4n, removed: false
        }]
      };
      return {
        hash: TX_HASH, chainId: CHAIN_ID, from: OWNER, to: CONTRACT, data, value: 0n,
        wait: vi.fn(async () => {
          throw {
            code: 'TRANSACTION_REPLACED', cancelled: false, reason: 'repriced', replacement, receipt
          };
        })
      };
    });
    mocks.loadCotiEthersModule.mockResolvedValue({
      Contract: vi.fn(function MockContract() { return { createTrade: write }; })
    });

    const submission = await submitStandardTradeV2Action({ ...context, action });
    await expect(confirmStandardTradeV2Action(submission)).resolves.toMatchObject({
      action: 'create', tradeId: '8', submittedTransactionHash: TX_HASH,
      transactionHash: replacementHash, blockNumber: '121', logIndex: 4
    });
  });

  it('rejects impossible full-fill policy combinations before opening a wallet prompt', async () => {
    const context = await setup();
    await expect(submitStandardTradeV2Action({
      ...context,
      action: {
        kind: 'create',
        offerAsset: { assetType: 'native', amount: 1n },
        requestAsset: { assetType: 'erc20', token: TOKEN_B, amount: 2n },
        fillPolicy: {
          partialFillsAllowed: false, minPartialFillBps: 1n,
          minRequestAmount: 0n, maxRequestAmountPerWallet: 0n, oneFillPerWallet: false
        },
        expiresAt: 0n
      }
    })).rejects.toThrow(/full-fill/i);
    expect(mocks.loadCotiEthersModule).not.toHaveBeenCalled();
  });
});
