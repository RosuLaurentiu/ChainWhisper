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
  decryptPrivateUint256Output: vi.fn(),
  encryptPrivateUint256Input: vi.fn(),
  loadCotiEthersModule: vi.fn()
}));

vi.mock('./appChain', () => ({ ensureTradeTokenAllowance: mocks.ensureTradeTokenAllowance }));
vi.mock('./privateUint256', () => ({
  decryptPrivateUint256Output: mocks.decryptPrivateUint256Output,
  encryptPrivateUint256Input: mocks.encryptPrivateUint256Input
}));
vi.mock('./appShared/core', async (importOriginal) => ({
  ...await importOriginal<typeof import('./appShared/core')>(),
  loadCotiEthersModule: mocks.loadCotiEthersModule
}));

import {
  PRIVATE_RECURRING_TRADE_V2_ACTION_ABI,
  confirmPrivateRecurringTradeV2Action,
  packPrivateRecurringExecution,
  packPrivateRecurringInventory,
  packPrivateRecurringLiquidityAdjustment,
  readPrivateRecurringTradeV2ExecutionReceipt,
  readPrivateRecurringTradeV2MakerInventory,
  readPrivateRecurringTradeV2OrderIds,
  readPrivateRecurringTradeV2OrderView,
  submitPrivateRecurringTradeV2Action
} from './privateRecurringTradeV2Actions';
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
const ABI = new Interface(PRIVATE_RECURRING_TRADE_V2_ACTION_ABI);
const METADATA = new Interface([
  'function contractVersion() view returns (string)',
  'function supportsFeature(bytes32 feature) view returns (bool)'
]);
const APP_WALLET = keccak256(toUtf8Bytes('APP_WALLET_EXECUTOR')).toLowerCase();
const ENCRYPTED = {
  ciphertext: { ciphertextHigh: 7n, ciphertextLow: 8n },
  signature: '0x1234'
};

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
        ? METADATA.encodeFunctionResult(parsed.name, ['ChainWhisperPrivateRecurringOTCEscrowV2'])
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
      protocol: 'private-recurring-v2',
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
  }, { chainId: Number(CHAIN_ID), name: 'Private Recurring OTC V2 test' });
  const decryptValue = vi.fn(async (value: { ciphertextHigh: bigint }) => value.ciphertextHigh);
  const signer = {
    provider,
    getAddress: vi.fn(async () => OWNER),
    sendUncheckedTransaction: vi.fn(),
    getUserOnboardInfo: vi.fn(() => ({ aesKey: '11'.repeat(16) })),
    decryptValue
  } as unknown as JsonRpcSigner;
  const capability = await bindOwnerTradeV2MetaMaskCapability({
    signer,
    browserProvider: provider,
    ownerAddress: OWNER,
    chainId: CHAIN_ID,
    assertCurrent: () => undefined
  });
  return { capability, deployment, signer, decryptValue };
};

const orderView = (revision = 2n) => ({
  order: {
    maker: MAKER,
    status: 1n,
    baseToken: TOKEN_A,
    quoteToken: TOKEN_B,
    buyTerms: { baseAmount: 10n, quoteAmount: 9n },
    sellTerms: { baseAmount: 10n, quoteAmount: 11n },
    createdAt: 1n,
    expiresAt: 0n,
    revision,
    executionCount: 1n,
    baseTokenCodeHash: hash('01'),
    quoteTokenCodeHash: hash('02')
  },
  effectiveStatus: 1n,
  pairKey: hash('bb')
});

const privateValue = (value: bigint) => ({
  ciphertext: { ciphertextHigh: 0n, ciphertextLow: 0n },
  userCiphertext: { ciphertextHigh: value, ciphertextLow: 0n }
});

describe('privateRecurringTradeV2Actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.decryptPrivateUint256Output.mockImplementation((
      _signer: unknown,
      ciphertext: { ciphertextHigh: bigint }
    ) => ciphertext.ciphertextHigh);
    mocks.encryptPrivateUint256Input.mockResolvedValue(ENCRYPTED);
  });

  it('packs create, execution, and signed-direction liquidity words exactly', () => {
    expect(packPrivateRecurringInventory(3n, 4n)).toBe((3n << 128n) + 4n);
    expect(packPrivateRecurringExecution(5n, 6n)).toBe((5n << 128n) + 6n);
    expect(packPrivateRecurringLiquidityAdjustment({
      base: { direction: 'remove', amount: 7n },
      quote: { direction: 'add', amount: 8n }
    })).toBe((1n << 255n) + (7n << 128n) + 8n);
    expect(() => packPrivateRecurringLiquidityAdjustment({
      base: { direction: 'add', amount: 0n },
      quote: { direction: 'remove', amount: 0n }
    })).toThrow(/cannot be empty/i);
  });

  it('reads bounded private recurring participant and active pages', async () => {
    const context = await setup();
    const getOrderIdsForFiller = vi.fn(async () => ({ ids: [6n, 5n], nextOffset: 2n }));
    const getActiveOrderIds = vi.fn(async () => [[4n], 0n]);
    mocks.loadCotiEthersModule.mockResolvedValue({
      Contract: vi.fn(function MockContract() { return { getOrderIdsForFiller, getActiveOrderIds }; })
    });

    await expect(readPrivateRecurringTradeV2OrderIds({
      ...context,
      scope: 'filler',
      limit: 20n
    })).resolves.toEqual({ orderIds: ['6', '5'], nextOffset: '2' });
    await expect(readPrivateRecurringTradeV2OrderIds({
      ...context,
      scope: 'active',
      limit: 20n
    })).resolves.toEqual({ orderIds: ['4'], nextOffset: '0' });
    expect(getOrderIdsForFiller).toHaveBeenCalledWith(OWNER.toLowerCase(), 0n, 20n);
    expect(getActiveOrderIds).toHaveBeenCalledWith(0n, 20n);
    await expect(readPrivateRecurringTradeV2OrderIds({
      ...context,
      scope: 'active',
      limit: 101n
    })).rejects.toThrow('cannot exceed 100');
  });

  it('reads public order terms and decrypts only owner/filler-scoped private values', async () => {
    const context = await setup();
    const getOrderView = vi.fn(async () => orderView());
    const getMyMakerInventorySnapshot = vi.fn(async () => ({
      sequence: 3n,
      initialized: true,
      baseAmount: privateValue(70n),
      quoteAmount: privateValue(140n)
    }));
    const getMyLatestExecutionReceipt = vi.fn(async () => ({
      executionIndex: 4n,
      initialized: true,
      side: 1n,
      baseAmount: privateValue(10n),
      quoteAmount: privateValue(11n)
    }));
    mocks.loadCotiEthersModule.mockResolvedValue({
      Contract: vi.fn(function MockContract() {
        return { getOrderView, getMyMakerInventorySnapshot, getMyLatestExecutionReceipt };
      })
    });

    await expect(readPrivateRecurringTradeV2OrderView({ ...context, orderId: 7n }))
      .resolves.toMatchObject({ orderId: '7', status: 'active', revision: '2' });
    await expect(readPrivateRecurringTradeV2MakerInventory({ ...context, orderId: 7n }))
      .resolves.toEqual({ orderId: '7', sequence: '3', baseAmount: '70', quoteAmount: '140' });
    await expect(readPrivateRecurringTradeV2ExecutionReceipt({ ...context, orderId: 7n }))
      .resolves.toEqual({
        orderId: '7', executionIndex: '4', side: 'sell', baseAmount: '10', quoteAmount: '11'
      });
    expect(mocks.decryptPrivateUint256Output).toHaveBeenCalledTimes(4);
    expect(context.decryptValue).not.toHaveBeenCalled();
  });

  it('uses one packed create input, two private approvals, and one exact receipt', async () => {
    const context = await setup();
    const event = ABI.getEvent('PrivateRecurringOrderOpened');
    if (!event) throw new Error('event missing');
    const encoded = ABI.encodeEventLog(event, [
      7n, OWNER, hash('bb'), TOKEN_A, TOKEN_B,
      [10n, 9n], [10n, 11n], 1n, 0n, 1n
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
    const action = {
      kind: 'create' as const,
      baseToken: TOKEN_A,
      quoteToken: TOKEN_B,
      buyTerms: { baseAmount: 10n, quoteAmount: 9n },
      sellTerms: { baseAmount: 10n, quoteAmount: 11n },
      baseInventory: 100n,
      quoteInventory: 200n,
      expiresAt: 0n
    };

    const submission = await submitPrivateRecurringTradeV2Action({ ...context, action });
    await expect(confirmPrivateRecurringTradeV2Action(submission)).resolves.toMatchObject({
      action: 'create', orderId: '7', transactionHash: TX_HASH, logIndex: 2
    });
    expect(mocks.encryptPrivateUint256Input).toHaveBeenCalledWith(
      expect.anything(),
      (100n << 128n) + 200n,
      CONTRACT,
      ABI.getFunction('createOrder')?.selector
    );
    expect(mocks.ensureTradeTokenAllowance).toHaveBeenNthCalledWith(
      1, expect.anything(), OWNER, TOKEN_A, 100n, 'private-erc20', CONTRACT
    );
    expect(mocks.ensureTradeTokenAllowance).toHaveBeenNthCalledWith(
      2, expect.anything(), OWNER, TOKEN_B, 200n, 'private-erc20', CONTRACT
    );
  });

  it('adjusts private liquidity with one ciphertext and approves only additions', async () => {
    const context = await setup();
    const getOrderView = vi.fn(async () => orderView());
    const event = ABI.getEvent('PrivateRecurringOrderEdited');
    if (!event) throw new Error('event missing');
    const encoded = ABI.encodeEventLog(event, [
      7n, MAKER, [10n, 9n], [10n, 11n], true, 0n, 3n
    ]);
    const write = vi.fn(async (...args: unknown[]) => {
      const data = ABI.encodeFunctionData('adjustLiquidity', args).toLowerCase();
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
        value: 0n,
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
      Contract: vi.fn(function MockContract() { return { getOrderView, adjustLiquidity: write }; })
    });

    const submission = await submitPrivateRecurringTradeV2Action({
      ...context,
      action: {
        kind: 'adjust-liquidity',
        orderId: 7n,
        expectedRevision: 2n,
        base: { direction: 'remove', amount: 5n },
        quote: { direction: 'add', amount: 8n }
      }
    });
    await expect(confirmPrivateRecurringTradeV2Action(submission)).resolves.toMatchObject({
      action: 'adjust-liquidity', orderId: '7', blockNumber: '121', logIndex: 3
    });
    expect(mocks.ensureTradeTokenAllowance).toHaveBeenCalledTimes(1);
    expect(mocks.ensureTradeTokenAllowance).toHaveBeenCalledWith(
      expect.anything(), OWNER, TOKEN_B, 8n, 'private-erc20', CONTRACT
    );
    expect(mocks.encryptPrivateUint256Input).toHaveBeenCalledWith(
      expect.anything(),
      (1n << 255n) + (5n << 128n) + 8n,
      CONTRACT,
      ABI.getFunction('adjustLiquidity')?.selector
    );
  });

  it('rejects a same-token create before privacy or allowance prompts', async () => {
    const context = await setup();
    await expect(submitPrivateRecurringTradeV2Action({
      ...context,
      action: {
        kind: 'create',
        baseToken: TOKEN_A,
        quoteToken: TOKEN_A,
        buyTerms: { baseAmount: 10n, quoteAmount: 9n },
        sellTerms: { baseAmount: 10n, quoteAmount: 11n },
        baseInventory: 100n,
        quoteInventory: 200n,
        expiresAt: 0n
      }
    })).rejects.toThrow(/must differ/i);
    expect(mocks.encryptPrivateUint256Input).not.toHaveBeenCalled();
    expect(mocks.ensureTradeTokenAllowance).not.toHaveBeenCalled();
  });
});
