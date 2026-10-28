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
  RECURRING_TRADE_V2_ACTION_ABI,
  confirmRecurringTradeV2Action,
  quoteRecurringTradeV2Execution,
  readRecurringTradeV2OrderIds,
  readRecurringTradeV2OrderView,
  submitRecurringTradeV2Action
} from './recurringTradeV2Actions';
import { bindOwnerTradeV2MetaMaskCapability } from './ownerTradeV2Capability';
import {
  attestTradeHistoryV2Deployment,
  bindTradeHistoryV2ReadCapability
} from './tradeHistoryV2Chain';

const address = (pair: string): string => `0x${pair.repeat(20)}`;
const hash = (pair: string): string => `0x${pair.repeat(32)}`;
const quantity = (value: bigint): string => `0x${value.toString(16)}`;
const blockHash = (number: bigint): string => `0x${number.toString(16).padStart(64, '0')}`;
const CHAIN_ID = 7_082_400n;
const CONTRACT = address('11');
const OWNER = address('22');
const MAKER = address('55');
const TOKEN_A = address('33');
const TOKEN_B = address('44');
const CODE = '0x6001600055';
const TX_HASH = hash('aa');
const ABI = new Interface(RECURRING_TRADE_V2_ACTION_ABI);
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
        ? METADATA.encodeFunctionResult(parsed.name, ['ChainWhisperRecurringOTCEscrowV2'])
        : METADATA.encodeFunctionResult(
            parsed.name,
            [String(parsed.args[0]).toLowerCase() !== APP_WALLET]
          );
    }
    throw new Error(`Unexpected RPC ${method}.`);
  }
}

const setup = async () => {
  const readCapability = await bindTradeHistoryV2ReadCapability({
    provider: new AttestationProvider(),
    expectedChainId: CHAIN_ID,
    assertCurrent: () => undefined
  });
  const deployment = await attestTradeHistoryV2Deployment({
    capability: readCapability,
    manifest: {
      protocol: 'recurring-v2',
      chainId: CHAIN_ID,
      contractAddress: CONTRACT,
      deploymentBlock: 100n,
      runtimeBytecodeHash: keccak256(CODE)
    },
    finalityLagBlocks: 5n
  });
  const provider = new BrowserProvider({
    request: vi.fn(async ({ method }: { method: string }) => {
      if (method === 'eth_chainId') return quantity(CHAIN_ID);
      if (method === 'eth_accounts') return [OWNER];
      return null;
    })
  }, { chainId: Number(CHAIN_ID), name: 'Recurring OTC V2 test' });
  const signer = {
    provider,
    getAddress: vi.fn(async () => OWNER),
    sendUncheckedTransaction: vi.fn(),
    getUserOnboardInfo: vi.fn(() => ({}))
  } as unknown as JsonRpcSigner;
  const capability = await bindOwnerTradeV2MetaMaskCapability({
    signer,
    browserProvider: provider,
    ownerAddress: OWNER,
    chainId: CHAIN_ID,
    assertCurrent: () => undefined
  });
  return { capability, deployment, signer };
};

const view = ({
  baseAssetType = 1n,
  baseToken = TOKEN_A,
  quoteAssetType = 1n,
  quoteToken = TOKEN_B,
  revision = 2n
}: {
  baseAssetType?: bigint;
  baseToken?: string;
  quoteAssetType?: bigint;
  quoteToken?: string;
  revision?: bigint;
} = {}) => ({
  order: {
    maker: MAKER,
    status: 1n,
    baseAsset: { assetType: baseAssetType, token: baseToken },
    quoteAsset: { assetType: quoteAssetType, token: quoteToken },
    buyTerms: { baseAmount: 10n, quoteAmount: 9n },
    sellTerms: { baseAmount: 10n, quoteAmount: 11n },
    createdAt: 1n,
    expiresAt: 0n,
    revision,
    executionCount: 1n,
    baseTokenCodeHash: hash('01'),
    quoteTokenCodeHash: hash('02')
  },
  inventory: { baseAmount: 80n, quoteAmount: 160n },
  effectiveStatus: 1n,
  pairKey: hash('bb')
});

const quote = (revision = 2n) => ({
  revision,
  nextExecutionIndex: 2n,
  inputAmount: 20n,
  outputAmount: 18n,
  baseInventoryAfter: 100n,
  quoteInventoryAfter: 142n,
  clippedToInventory: false
});

describe('recurringTradeV2Actions', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reads canonical inventory and quotes for the connected filler', async () => {
    const context = await setup();
    const getOrderView = vi.fn(async () => view());
    const quoteExecutionFor = vi.fn(async () => quote());
    mocks.loadCotiEthersModule.mockResolvedValue({
      Contract: vi.fn(function MockContract() { return { getOrderView, quoteExecutionFor }; })
    });

    await expect(readRecurringTradeV2OrderView({ ...context, orderId: 7n })).resolves.toMatchObject({
      orderId: '7',
      status: 'active',
      revision: '2',
      baseInventory: '80',
      quoteInventory: '160'
    });
    await expect(quoteRecurringTradeV2Execution({
      ...context,
      orderId: 7n,
      side: 'buy',
      maxInputAmount: 20n
    })).resolves.toMatchObject({ revision: '2', inputAmount: '20', outputAmount: '18' });
    expect(quoteExecutionFor).toHaveBeenCalledWith(7n, OWNER, 0n, 20n);
  });

  it('reads bounded maker and active order ID pages', async () => {
    const context = await setup();
    const getOrderIdsForMaker = vi.fn(async () => ({ ids: [9n, 7n], nextOffset: 2n }));
    const getActiveOrderIds = vi.fn(async () => [[8n], 0n]);
    mocks.loadCotiEthersModule.mockResolvedValue({
      Contract: vi.fn(function MockContract() { return { getOrderIdsForMaker, getActiveOrderIds }; })
    });

    await expect(readRecurringTradeV2OrderIds({
      ...context,
      scope: 'maker',
      offset: 0n,
      limit: 25n
    })).resolves.toEqual({ orderIds: ['9', '7'], nextOffset: '2' });
    await expect(readRecurringTradeV2OrderIds({
      ...context,
      scope: 'active',
      limit: 25n
    })).resolves.toEqual({ orderIds: ['8'], nextOffset: '0' });
    expect(getOrderIdsForMaker).toHaveBeenCalledWith(OWNER.toLowerCase(), 0n, 25n);
    expect(getActiveOrderIds).toHaveBeenCalledWith(0n, 25n);
    await expect(readRecurringTradeV2OrderIds({
      ...context,
      scope: 'active',
      limit: 101n
    })).rejects.toThrow('cannot exceed 100');
  });

  it('approves both ERC20 inventories and binds one exact create receipt', async () => {
    const context = await setup();
    const action = {
      kind: 'create' as const,
      baseAsset: { assetType: 'erc20' as const, token: TOKEN_A },
      quoteAsset: { assetType: 'erc20' as const, token: TOKEN_B },
      buyTerms: { baseAmount: 10n, quoteAmount: 9n },
      sellTerms: { baseAmount: 10n, quoteAmount: 11n },
      initialBaseInventory: 100n,
      initialQuoteInventory: 200n,
      expiresAt: 0n
    };
    const event = ABI.getEvent('RecurringOrderOpened');
    if (!event) throw new Error('event missing');
    const encoded = ABI.encodeEventLog(event, [
      7n, OWNER, hash('bb'), 1n, TOKEN_A, 1n, TOKEN_B,
      [10n, 9n], [10n, 11n], 100n, 200n, 1n, 0n, 1n
    ]);
    const write = vi.fn(async (...args: unknown[]) => {
      const data = ABI.encodeFunctionData('createOrder', args).toLowerCase();
      const log = {
        address: CONTRACT,
        topics: encoded.topics,
        data: encoded.data,
        blockNumber: 120n,
        blockHash: blockHash(120n),
        transactionHash: TX_HASH,
        logIndex: 2n,
        removed: false
      };
      return {
        hash: TX_HASH,
        chainId: CHAIN_ID,
        from: OWNER,
        to: CONTRACT,
        data,
        value: 0n,
        wait: vi.fn(async () => ({
          status: 1n,
          hash: TX_HASH,
          blockNumber: 120n,
          blockHash: blockHash(120n),
          logs: [log]
        }))
      };
    });
    mocks.loadCotiEthersModule.mockResolvedValue({
      Contract: vi.fn(function MockContract() { return { createOrder: write }; })
    });

    const submission = await submitRecurringTradeV2Action({ ...context, action });
    await expect(confirmRecurringTradeV2Action(submission)).resolves.toMatchObject({
      action: 'create',
      orderId: '7',
      transactionHash: TX_HASH,
      logIndex: 2
    });
    expect(mocks.ensureTradeTokenAllowance).toHaveBeenNthCalledWith(
      1, expect.anything(), OWNER, TOKEN_A, 100n, 'erc20', CONTRACT
    );
    expect(mocks.ensureTradeTokenAllowance).toHaveBeenNthCalledWith(
      2, expect.anything(), OWNER, TOKEN_B, 200n, 'erc20', CONTRACT
    );
    expect(write).toHaveBeenCalledTimes(1);
  });

  it('uses the exact quoted native input and revision-bound execution event', async () => {
    const context = await setup();
    const getOrderView = vi.fn(async () => view({
      baseAssetType: 0n,
      baseToken: address('00')
    }));
    const quoteExecutionFor = vi.fn(async () => quote());
    const event = ABI.getEvent('RecurringOrderExecuted');
    if (!event) throw new Error('event missing');
    const encoded = ABI.encodeEventLog(event, [
      7n, OWNER, MAKER, 0n, 2n, 3n, 20n, 18n, 100n, 142n
    ]);
    const write = vi.fn(async (...args: unknown[]) => {
      const overrides = args.pop() as { value: bigint };
      expect(overrides).toEqual({ value: 20n });
      const data = ABI.encodeFunctionData('execute', args).toLowerCase();
      const log = {
        address: CONTRACT,
        topics: encoded.topics,
        data: encoded.data,
        blockNumber: 121n,
        blockHash: blockHash(121n),
        transactionHash: TX_HASH,
        logIndex: 3n,
        removed: false
      };
      return {
        hash: TX_HASH,
        chainId: CHAIN_ID,
        from: OWNER,
        to: CONTRACT,
        data,
        value: 20n,
        wait: vi.fn(async () => ({
          status: 1n,
          hash: TX_HASH,
          blockNumber: 121n,
          blockHash: blockHash(121n),
          logs: [log]
        }))
      };
    });
    mocks.loadCotiEthersModule.mockResolvedValue({
      Contract: vi.fn(function MockContract() { return { getOrderView, quoteExecutionFor, execute: write }; })
    });

    const submission = await submitRecurringTradeV2Action({
      ...context,
      action: {
        kind: 'execute',
        orderId: 7n,
        side: 'buy',
        expectedRevision: 2n,
        maxInputAmount: 25n,
        minOutputAmount: 17n
      }
    });
    await expect(confirmRecurringTradeV2Action(submission)).resolves.toMatchObject({
      action: 'execute', orderId: '7', blockNumber: '121', logIndex: 3
    });
    expect(mocks.ensureTradeTokenAllowance).not.toHaveBeenCalled();
  });

  it('rejects invalid pairs before allowance or wallet submission', async () => {
    const context = await setup();
    await expect(submitRecurringTradeV2Action({
      ...context,
      action: {
        kind: 'create',
        baseAsset: { assetType: 'erc20', token: TOKEN_A },
        quoteAsset: { assetType: 'erc20', token: TOKEN_A },
        buyTerms: { baseAmount: 10n, quoteAmount: 9n },
        sellTerms: { baseAmount: 10n, quoteAmount: 11n },
        initialBaseInventory: 100n,
        initialQuoteInventory: 200n,
        expiresAt: 0n
      }
    })).rejects.toThrow(/must differ/i);
    expect(mocks.ensureTradeTokenAllowance).not.toHaveBeenCalled();
    expect(mocks.loadCotiEthersModule).not.toHaveBeenCalled();
  });
});
