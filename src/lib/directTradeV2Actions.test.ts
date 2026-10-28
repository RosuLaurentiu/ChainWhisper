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
  loadCotiEthersModule: vi.fn(),
  decryptPrivateUint256Output: vi.fn(),
  encryptPrivateUint256Input: vi.fn()
}));

vi.mock('./appShared/core', async (importOriginal) => ({
  ...await importOriginal<typeof import('./appShared/core')>(),
  loadCotiEthersModule: mocks.loadCotiEthersModule
}));
vi.mock('./privateUint256', async (importOriginal) => ({
  ...await importOriginal<typeof import('./privateUint256')>(),
  decryptPrivateUint256Output: mocks.decryptPrivateUint256Output,
  encryptPrivateUint256Input: mocks.encryptPrivateUint256Input
}));
vi.mock('./appChain', () => ({
  ensureTradeTokenAllowance: mocks.ensureTradeTokenAllowance
}));

import {
  DIRECT_TRADE_V2_ACTION_GAS_LIMIT,
  DIRECT_TRADE_V2_ACTION_ABI,
  bindDirectTradeV2MetaMaskCapability,
  confirmDirectTradeV2Action,
  ensureDirectTradeV2ActionAllowance,
  readDirectTradeV2PublicTradeTerms,
  readDirectTradeV2TradeIds,
  readDirectTradeV2TradeTerms,
  submitDirectTradeV2Action
} from './directTradeV2Actions';
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
const TAKER = address('33');
const TOKEN_A = address('44');
const TOKEN_B = address('55');
const ZERO = address('00');
const CODE = '0x6001600055';
const TX_HASH = hash('aa');
const ACTIONS = new Interface(DIRECT_TRADE_V2_ACTION_ABI);
const METADATA = new Interface([
  'function contractVersion() view returns (string)',
  'function supportsFeature(bytes32 feature) view returns (bool)'
]);
const APP_WALLET_FEATURE = keccak256(toUtf8Bytes('APP_WALLET_EXECUTOR')).toLowerCase();

class AttestationProvider {
  readonly calls: Array<{ method: string; params: readonly unknown[] }> = [];

  constructor(
    private readonly privateTrade = false,
    private readonly malformedPrivateTerms = false
  ) {}

  async request({ method, params = [] }: { method: string; params?: readonly unknown[] }): Promise<unknown> {
    this.calls.push({ method, params });
    if (method === 'eth_chainId') return quantity(CHAIN_ID);
    if (method === 'eth_blockNumber') return quantity(130n);
    if (method === 'eth_getBlockByNumber') {
      const number = BigInt(String(params[0]));
      return { number: quantity(number), hash: blockHash(number), transactions: [] };
    }
    if (method === 'eth_getCode') return CODE;
    if (method === 'eth_call') {
      const data = (params[0] as { data: string }).data;
      if (data.slice(0, 10).toLowerCase() === ACTIONS.getFunction('getTradeView')?.selector.toLowerCase()) {
        return ACTIONS.encodeFunctionResult('getTradeView', [[
          [
            OWNER, TAKER, 1n, this.privateTrade ? 1n : 0n,
            [this.privateTrade ? 2n : 1n, TOKEN_A], [this.privateTrade ? 2n : 1n, TOKEN_B],
            1_700_000_000n, 1_700_086_400n,
            0n, 7n, 0n, true, hash('12'), hash('13')
          ],
          [10n, 25n],
          1n, 0n, 0n, 0n
        ]]);
      }
      if (data.slice(0, 10).toLowerCase() === ACTIONS.getFunction('getPrivateTermsForAccount')?.selector.toLowerCase()) {
        if (this.malformedPrivateTerms) return '0x';
        return ACTIONS.encodeFunctionResult('getPrivateTermsForAccount', [[
          true,
          [[0n, 0n], [1n, 2n]],
          [[0n, 0n], [3n, 4n]]
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
  }
}

const browserProvider = (): BrowserProvider => new BrowserProvider({
  request: vi.fn(async ({ method }: { method: string }) => {
    if (method === 'eth_chainId') return quantity(CHAIN_ID);
    if (method === 'eth_accounts') return [OWNER];
    return null;
  })
}, { chainId: Number(CHAIN_ID), name: 'Direct Trade V2 test' });

const signer = (provider = browserProvider()) => ({
  provider,
  getAddress: vi.fn(async () => OWNER),
  sendUncheckedTransaction: vi.fn(),
  decryptValue: vi.fn(),
  getUserOnboardInfo: vi.fn(() => ({ aesKey: 'test-aes-key' }))
}) as unknown as JsonRpcSigner;

const setup = async ({
  assertCurrent = vi.fn(async () => undefined),
  assertSnapshotCurrent = vi.fn(() => undefined),
  privateTrade = false,
  malformedPrivateTerms = false
}: {
  assertCurrent?: () => void | Promise<void>;
  assertSnapshotCurrent?: () => void;
  privateTrade?: boolean;
  malformedPrivateTerms?: boolean;
} = {}) => {
  const readProvider = new AttestationProvider(privateTrade, malformedPrivateTerms);
  const readCapability = await bindTradeHistoryV2ReadCapability({
    provider: readProvider,
    expectedChainId: CHAIN_ID,
    assertCurrent: () => undefined
  });
  const deployment = await attestTradeHistoryV2Deployment({
    capability: readCapability,
    manifest: {
      protocol: 'direct-v2',
      chainId: CHAIN_ID,
      contractAddress: CONTRACT,
      deploymentBlock: 100n,
      runtimeBytecodeHash: keccak256(CODE)
    },
    finalityLagBlocks: 5n
  });
  const provider = browserProvider();
  const ownerSigner = signer(provider);
  const capability = await bindDirectTradeV2MetaMaskCapability({
    signer: ownerSigner,
    browserProvider: provider,
    ownerAddress: OWNER,
    chainId: CHAIN_ID,
    assertCurrent,
    assertSnapshotCurrent
  });
  return {
    capability,
    deployment,
    ownerSigner,
    readCapability,
    readProvider,
    assertCurrent,
    assertSnapshotCurrent
  };
};

const installAction = ({
  method,
  eventName,
  eventArgs,
  value = 0n,
  transactionHash = TX_HASH,
  replacementTransactionHash,
  replacementData,
  useEthersLogIndex = false,
  transactionChainId = CHAIN_ID
}: {
  method: string;
  eventName: 'DirectTradeOpened' | 'DirectTradeStatusChanged' | 'NativeCreditWithdrawn';
  eventArgs: readonly unknown[];
  value?: bigint;
  transactionHash?: string;
  replacementTransactionHash?: string;
  replacementData?: string;
  useEthersLogIndex?: boolean;
  transactionChainId?: unknown;
}) => {
  const call = vi.fn(async (...received: unknown[]) => {
    const args = [...received];
    const last = args[args.length - 1];
    if (last && typeof last === 'object' && (
      'value' in (last as object) || 'gasLimit' in (last as object)
    )) args.pop();
    const data = ACTIONS.encodeFunctionData(method, args).toLowerCase();
    const event = ACTIONS.getEvent(eventName);
    if (!event) throw new Error(`Missing ${eventName}.`);
    const encoded = ACTIONS.encodeEventLog(event, [...eventArgs]);
    const effectiveTransactionHash = replacementTransactionHash ?? transactionHash;
    const log = {
      address: CONTRACT,
      topics: encoded.topics,
      data: encoded.data,
      blockNumber: 120n,
      blockHash: blockHash(120n),
      transactionHash: effectiveTransactionHash,
      ...(useEthersLogIndex ? { index: 2n } : { logIndex: 2n }),
      removed: false
    };
    const receipt = {
      status: 1n,
      hash: effectiveTransactionHash,
      transactionHash: effectiveTransactionHash,
      blockNumber: 120n,
      blockHash: blockHash(120n),
      logs: [log]
    };
    const transaction = {
      hash: transactionHash,
      chainId: transactionChainId,
      from: OWNER,
      to: CONTRACT,
      data,
      value,
      wait: vi.fn(async () => {
        if (replacementTransactionHash) {
          throw Object.assign(new Error('transaction replaced'), {
            code: 'TRANSACTION_REPLACED',
            cancelled: false,
            reason: 'repriced',
            replacement: {
              hash: replacementTransactionHash,
              chainId: CHAIN_ID,
              from: OWNER,
              to: CONTRACT,
              data: replacementData ?? data,
              value,
              wait: vi.fn(async () => receipt)
            },
            receipt
          });
        }
        return receipt;
      })
    };
    return transaction;
  });
  mocks.loadCotiEthersModule.mockResolvedValue({
    Contract: vi.fn(function MockContract() { return { [method]: call }; })
  });
  return call;
};

describe('directTradeV2Actions', () => {
  it('checks candidate admission before allowance, encryption or submission', async () => {
    const { capability, deployment } = await setup();
    const action = { kind: 'create-private' as const, offerToken: TOKEN_A, requestToken: TOKEN_B,
      offerAmount: 10n, requestAmount: 25n, taker: TAKER, expiresAt: 1_800_000_000n };
    const actionAdmission = { chainId: deployment.chainId, contractAddress: deployment.contractAddress,
      runtimeBytecodeHash: deployment.runtimeBytecodeHash, mode: 'held' as const };
    await expect(ensureDirectTradeV2ActionAllowance({ capability, deployment, action, actionAdmission })).rejects.toThrow(/activation/);
    await expect(submitDirectTradeV2Action({ capability, deployment, action, actionAdmission })).rejects.toThrow(/activation/);
    expect(mocks.ensureTradeTokenAllowance).not.toHaveBeenCalled();
    expect(mocks.encryptPrivateUint256Input).not.toHaveBeenCalled();
    expect(mocks.loadCotiEthersModule).not.toHaveBeenCalled();
    await ensureDirectTradeV2ActionAllowance({ capability, deployment, action, actionAdmission: { ...actionAdmission, mode: 'private-forward' } });
    expect(mocks.ensureTradeTokenAllowance).toHaveBeenCalledOnce();
    await expect(submitDirectTradeV2Action({ capability, deployment, action: { ...action, kind: 'counter-private', parentTradeId: 7n },
      actionAdmission: { ...actionAdmission, mode: 'private-forward' } })).rejects.toThrow(/not ready/);
    expect(mocks.encryptPrivateUint256Input).not.toHaveBeenCalled();
  });
  beforeEach(() => {
    mocks.ensureTradeTokenAllowance.mockReset();
    mocks.ensureTradeTokenAllowance.mockResolvedValue(undefined);
    mocks.loadCotiEthersModule.mockReset();
    mocks.decryptPrivateUint256Output.mockReset();
    mocks.decryptPrivateUint256Output.mockReturnValueOnce(10n).mockReturnValueOnce(25n);
    mocks.encryptPrivateUint256Input.mockReset();
    mocks.encryptPrivateUint256Input
      .mockResolvedValueOnce({ ciphertext: { ciphertextHigh: 1n, ciphertextLow: 2n }, signature: '0x1234' })
      .mockResolvedValueOnce({ ciphertext: { ciphertextHigh: 3n, ciphertextLow: 4n }, signature: '0x5678' });
  });

  it('uses the exact token and V2 escrow for the one-time allowance gate', async () => {
    const context = await setup();
    await ensureDirectTradeV2ActionAllowance({
      ...context,
      action: {
        kind: 'create-public',
        offerAsset: { assetType: 'erc20', token: TOKEN_A },
        requestAsset: { assetType: 'erc20', token: TOKEN_B },
        offerAmount: 10n,
        requestAmount: 25n,
        taker: TAKER,
        expiresAt: 0n
      }
    });
    expect(mocks.ensureTradeTokenAllowance).toHaveBeenCalledWith(
      expect.anything(), OWNER, TOKEN_A, 10n, 'erc20', CONTRACT
    );
  });

  it('reads exact participant terms and reveals private amounts only with the privacy capability', async () => {
    const context = await setup({ privateTrade: true });
    await expect(readDirectTradeV2TradeTerms({
      ...context,
      tradeId: 7n,
      decryptPrivateAmounts: true
    })).resolves.toMatchObject({
      tradeId: '7',
      maker: OWNER,
      taker: TAKER,
      status: 'open',
      amountMode: 'private',
      offerAmount: '10',
      requestAmount: '25',
      offerAsset: { assetType: 'private-erc20', token: TOKEN_A },
      requestAsset: { assetType: 'private-erc20', token: TOKEN_B }
    });
    expect(mocks.decryptPrivateUint256Output).toHaveBeenCalledTimes(2);
    expect(context.ownerSigner.decryptValue).not.toHaveBeenCalled();
    expect(mocks.loadCotiEthersModule).not.toHaveBeenCalled();
    const privateRead = context.readProvider.calls.find(({ method, params }) => {
      if (method !== 'eth_call') return false;
      const request = params[0] as { data?: string };
      return request.data?.slice(0, 10).toLowerCase() ===
        ACTIONS.getFunction('getPrivateTermsForAccount')?.selector.toLowerCase();
    });
    expect(privateRead?.params[0]).toMatchObject({ from: OWNER, to: CONTRACT });
  });

  it('reads public participant terms without touching the browser-wallet signer', async () => {
    const context = await setup();
    const getAddressCalls = vi.mocked(context.ownerSigner.getAddress).mock.calls.length;

    await expect(readDirectTradeV2PublicTradeTerms({
      capability: context.readCapability,
      deployment: context.deployment,
      ownerAddress: OWNER,
      tradeId: 7n
    })).resolves.toMatchObject({
      tradeId: '7',
      maker: OWNER,
      taker: TAKER,
      status: 'open',
      amountMode: 'public',
      offerAmount: '10',
      requestAmount: '25'
    });

    expect(context.ownerSigner.getAddress).toHaveBeenCalledTimes(getAddressCalls);
    expect(context.ownerSigner.decryptValue).not.toHaveBeenCalled();
    expect(mocks.loadCotiEthersModule).not.toHaveBeenCalled();
  });

  it('fails with a controlled error when the public RPC returns incomplete private terms', async () => {
    const context = await setup({ privateTrade: true, malformedPrivateTerms: true });

    await expect(readDirectTradeV2TradeTerms({
      ...context,
      tradeId: 7n,
      decryptPrivateAmounts: true
    })).rejects.toThrow('Direct private terms returned malformed ABI data.');
    expect(mocks.decryptPrivateUint256Output).not.toHaveBeenCalled();
    expect(mocks.loadCotiEthersModule).not.toHaveBeenCalled();
  });

  it('reads bounded taker and parent-counter discovery pages', async () => {
    const context = await setup();
    const getTradeIdsForTaker = vi.fn(async () => ({ ids: [8n, 6n], nextOffset: 2n }));
    const getCounterTradeIdsForParent = vi.fn(async () => [[15n, 14n], 5n]);
    mocks.loadCotiEthersModule.mockResolvedValue({
      Contract: vi.fn(function MockContract() {
        return { getTradeIdsForTaker, getCounterTradeIdsForParent };
      })
    });

    await expect(readDirectTradeV2TradeIds({
      ...context, scope: 'taker', offset: 0n, limit: 20n
    })).resolves.toEqual({ tradeIds: ['8', '6'], nextOffset: '2' });
    await expect(readDirectTradeV2TradeIds({
      ...context, scope: 'counter', parentTradeId: 4n, offset: 3n, limit: 10n
    })).resolves.toEqual({ tradeIds: ['15', '14'], nextOffset: '5' });
    expect(getTradeIdsForTaker).toHaveBeenCalledWith(OWNER.toLowerCase(), 0n, 20n);
    expect(getCounterTradeIdsForParent).toHaveBeenCalledWith(4n, 3n, 10n);
  });

  it('creates a public recipient trade in one exact transaction and confirms its canonical card event', async () => {
    const context = await setup();
    const call = installAction({
      method: 'createPublicTrade',
      eventName: 'DirectTradeOpened',
      eventArgs: [7n, OWNER, TAKER, ZERO, 0n, 7n, 0n, 0n, ZERO, 1n, TOKEN_B, 0n, 10n, 25n, 1_700_000_000n, 0n],
      value: 10n
    });
    const submission = await submitDirectTradeV2Action({
      ...context,
      action: {
        kind: 'create-public',
        offerAsset: { assetType: 'native' },
        requestAsset: { assetType: 'erc20', token: TOKEN_B },
        offerAmount: 10n,
        requestAmount: 25n,
        taker: TAKER,
        expiresAt: 0n
      }
    });
    expect(call).toHaveBeenCalledOnce();
    expect(mocks.encryptPrivateUint256Input).not.toHaveBeenCalled();
    await expect(confirmDirectTradeV2Action(submission)).resolves.toMatchObject({
      action: 'create-public',
      tradeId: '7',
      submittedTransactionHash: TX_HASH,
      transactionHash: TX_HASH,
      blockNumber: '120',
      logIndex: 2
    });
  });

  it('accepts a COTI transaction response that omits chainId while retaining the bound deployment chain', async () => {
    const context = await setup();
    installAction({
      method: 'createPublicTrade',
      eventName: 'DirectTradeOpened',
      eventArgs: [17n, OWNER, TAKER, ZERO, 0n, 17n, 0n, 0n, ZERO, 1n, TOKEN_B, 0n, 10n, 25n, 1_700_000_000n, 0n],
      value: 10n,
      transactionChainId: undefined
    });

    const submission = await submitDirectTradeV2Action({
      ...context,
      action: {
        kind: 'create-public',
        offerAsset: { assetType: 'native' },
        requestAsset: { assetType: 'erc20', token: TOKEN_B },
        offerAmount: 10n,
        requestAmount: 25n,
        taker: TAKER,
        expiresAt: 0n
      }
    });

    expect(submission.transaction.chainId).toBe(CHAIN_ID);
    await expect(confirmDirectTradeV2Action(submission)).resolves.toMatchObject({ tradeId: '17' });
  });

  it('still rejects an explicit transaction chain that differs from the bound deployment', async () => {
    const context = await setup();
    installAction({
      method: 'createPublicTrade',
      eventName: 'DirectTradeOpened',
      eventArgs: [18n, OWNER, TAKER, ZERO, 0n, 18n, 0n, 0n, ZERO, 1n, TOKEN_B, 0n, 10n, 25n, 1_700_000_000n, 0n],
      value: 10n,
      transactionChainId: 1n
    });

    await expect(submitDirectTradeV2Action({
      ...context,
      action: {
        kind: 'create-public',
        offerAsset: { assetType: 'native' },
        requestAsset: { assetType: 'erc20', token: TOKEN_B },
        offerAmount: 10n,
        requestAmount: 25n,
        taker: TAKER,
        expiresAt: 0n
      }
    })).rejects.toThrow('does not match the exact intended action');
  });

  it('packs a private create into exactly two sequential COTI inputs and one transaction', async () => {
    const context = await setup();
    const call = installAction({
      method: 'createPrivateTrade',
      eventName: 'DirectTradeOpened',
      eventArgs: [8n, OWNER, TAKER, ZERO, 0n, 8n, 0n, 2n, TOKEN_A, 2n, TOKEN_B, 1n, 0n, 0n, 1_700_000_001n, 0n],
      useEthersLogIndex: true
    });
    const submission = await submitDirectTradeV2Action({
      ...context,
      action: {
        kind: 'create-private',
        offerToken: TOKEN_A,
        requestToken: TOKEN_B,
        offerAmount: 55n,
        requestAmount: 89n,
        taker: TAKER,
        expiresAt: 0n
      }
    });
    expect(mocks.encryptPrivateUint256Input).toHaveBeenCalledTimes(2);
    expect(mocks.encryptPrivateUint256Input.mock.calls.map((call) => call[1])).toEqual([55n, 89n]);
    const privateCreateArguments = call.mock.calls[0] ?? [];
    expect(privateCreateArguments[privateCreateArguments.length - 1]).toEqual({
      gasLimit: DIRECT_TRADE_V2_ACTION_GAS_LIMIT
    });
    await expect(confirmDirectTradeV2Action(submission)).resolves.toMatchObject({ tradeId: '8' });
  });

  it('packs private counter and replacement actions against their exact parent IDs', async () => {
    const context = await setup();
    const counterCall = installAction({
      method: 'createPrivateCounterTrade',
      eventName: 'DirectTradeOpened',
      eventArgs: [9n, OWNER, TAKER, CONTRACT, 7n, 7n, 1n, 2n, TOKEN_A, 2n, TOKEN_B, 1n, 0n, 0n, 1_700_000_002n, 0n]
    });
    const counter = await submitDirectTradeV2Action({
      ...context,
      actionAdmission: { ...context.deployment, mode: 'private-forward', privateCounter: true },
      action: {
        kind: 'counter-private',
        parentTradeId: 7n,
        offerToken: TOKEN_A,
        requestToken: TOKEN_B,
        offerAmount: 34n,
        requestAmount: 55n,
        expiresAt: 0n
      }
    });
    expect(counterCall.mock.calls[0]?.[0]).toBe(7n);
    await expect(confirmDirectTradeV2Action(counter)).resolves.toMatchObject({
      action: 'counter-private',
      tradeId: '9'
    });

    mocks.encryptPrivateUint256Input
      .mockResolvedValueOnce({ ciphertext: { ciphertextHigh: 5n, ciphertextLow: 6n }, signature: '0x9abc' })
      .mockResolvedValueOnce({ ciphertext: { ciphertextHigh: 7n, ciphertextLow: 8n }, signature: '0xdef0' });
    const replacementCall = installAction({
      method: 'replaceWithPrivateTrade',
      eventName: 'DirectTradeOpened',
      eventArgs: [10n, OWNER, TAKER, ZERO, 0n, 7n, 0n, 2n, TOKEN_A, 2n, TOKEN_B, 1n, 0n, 0n, 1_700_000_003n, 0n]
    });
    const replacement = await submitDirectTradeV2Action({
      ...context,
      action: {
        kind: 'replace-private',
        originalTradeId: 9n,
        offerToken: TOKEN_A,
        requestToken: TOKEN_B,
        offerAmount: 21n,
        requestAmount: 34n,
        expiresAt: 0n
      }
    });
    expect(replacementCall.mock.calls[0]?.[0]).toBe(9n);
    await expect(confirmDirectTradeV2Action(replacement)).resolves.toMatchObject({
      action: 'replace-private',
      tradeId: '10'
    });
  });

  it('reconciles an already-broadcast action even if the owner session retires while it mines', async () => {
    let current = true;
    const assertCurrent = vi.fn(async () => {
      if (!current) throw new Error('Owner wallet session changed.');
    });
    const context = await setup({ assertCurrent });
    installAction({
      method: 'cancelTrade',
      eventName: 'DirectTradeStatusChanged',
      eventArgs: [7n, OWNER, TAKER, 1n, 3n, OWNER, 7n, 1_700_000_200n]
    });
    const submission = await submitDirectTradeV2Action({
      ...context,
      action: { kind: 'cancel', tradeId: 7n }
    });
    const checksBeforeConfirmation = assertCurrent.mock.calls.length;
    current = false;

    await expect(confirmDirectTradeV2Action(submission)).resolves.toMatchObject({
      action: 'cancel',
      tradeId: '7',
      nextStatus: '3'
    });
    expect(assertCurrent).toHaveBeenCalledTimes(checksBeforeConfirmation);
  });

  it('accepts an exact repriced transaction and rejects a replacement that changes calldata', async () => {
    const context = await setup();
    const replacementHash = hash('bb');
    installAction({
      method: 'cancelTrade',
      eventName: 'DirectTradeStatusChanged',
      eventArgs: [7n, OWNER, TAKER, 1n, 3n, OWNER, 7n, 1_700_000_201n],
      replacementTransactionHash: replacementHash
    });
    const repriced = await submitDirectTradeV2Action({
      ...context,
      action: { kind: 'cancel', tradeId: 7n }
    });
    await expect(confirmDirectTradeV2Action(repriced)).resolves.toMatchObject({
      submittedTransactionHash: TX_HASH,
      transactionHash: replacementHash
    });

    installAction({
      method: 'cancelTrade',
      eventName: 'DirectTradeStatusChanged',
      eventArgs: [8n, OWNER, TAKER, 1n, 3n, OWNER, 8n, 1_700_000_202n],
      replacementTransactionHash: hash('cc'),
      replacementData: '0x12345678'
    });
    const changed = await submitDirectTradeV2Action({
      ...context,
      action: { kind: 'cancel', tradeId: 8n }
    });
    await expect(confirmDirectTradeV2Action(changed)).rejects.toThrow(/replacement.*exact intended action/i);
  });

  it('accepts a public trade in one exact transaction and binds the status receipt', async () => {
    const context = await setup();
    installAction({
      method: 'acceptPublicTrade',
      eventName: 'DirectTradeStatusChanged',
      eventArgs: [7n, OWNER, TAKER, 1n, 2n, TAKER, 7n, 1_700_000_100n],
      value: 25n
    });
    const submission = await submitDirectTradeV2Action({
      ...context,
      action: {
        kind: 'accept-public',
        tradeId: 7n,
        expectedOfferAmount: 10n,
        expectedRequestAmount: 25n,
        requestAsset: { assetType: 'native' }
      }
    });
    await expect(confirmDirectTradeV2Action(submission)).resolves.toMatchObject({
      action: 'accept-public',
      tradeId: '7',
      nextStatus: '2',
      relatedTradeId: '7'
    });
  });

  it('rejects a receipt whose status event belongs to another trade', async () => {
    const context = await setup();
    installAction({
      method: 'cancelTrade',
      eventName: 'DirectTradeStatusChanged',
      eventArgs: [8n, OWNER, TAKER, 1n, 3n, OWNER, 8n, 1_700_000_200n]
    });
    const submission = await submitDirectTradeV2Action({
      ...context,
      action: { kind: 'cancel', tradeId: 7n }
    });
    await expect(confirmDirectTradeV2Action(submission)).rejects.toThrow(/missing the exact action event/);
  });

  it('rejects generic RPC and private-key signers before any transaction', async () => {
    const provider = browserProvider();
    await expect(bindDirectTradeV2MetaMaskCapability({
      signer: { ...signer(provider), privateKey: hash('99') } as unknown as JsonRpcSigner,
      browserProvider: provider,
      ownerAddress: OWNER,
      chainId: CHAIN_ID,
      assertCurrent: () => undefined
    })).rejects.toThrow(/exact COTI BrowserProvider session/);
  });
});
