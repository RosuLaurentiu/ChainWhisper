import { BrowserProvider, Interface, type JsonRpcSigner } from '@coti-io/coti-ethers';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  loadCotiEthersModule: vi.fn(),
  decryptPrivateUint256Output: vi.fn(),
  encryptPrivateUint256Input: vi.fn(),
  assertAttestedPrivateLiquidityDeployment: vi.fn()
}));

vi.mock('./appShared/core', async (importOriginal) => ({
  ...await importOriginal<typeof import('./appShared/core')>(),
  loadCotiEthersModule: mocks.loadCotiEthersModule
}));
vi.mock('./privateUint256', () => ({
  decryptPrivateUint256Output: mocks.decryptPrivateUint256Output,
  encryptPrivateUint256Input: mocks.encryptPrivateUint256Input
}));
vi.mock('./privateLiquidityChain', async (importOriginal) => ({
  ...await importOriginal<typeof import('./privateLiquidityChain')>(),
  assertAttestedPrivateLiquidityDeployment: mocks.assertAttestedPrivateLiquidityDeployment,
  assertCompleteCanonicalPrivateLiquidityPositionSnapshot: vi.fn()
}));

import {
  PRIVATE_LIQUIDITY_ACTION_GAS_LIMIT,
  PRIVATE_LIQUIDITY_ACTION_ABI,
  PRIVATE_LIQUIDITY_CREATE_HIDDEN_INTENT_SELECTOR,
  bindPrivateLiquidityMetaMaskCapability,
  confirmPrivateLiquidityHiddenIntentAction,
  confirmPrivateLiquidityHiddenIntentSettlement,
  readPrivateLiquidityHiddenIntentPairStatus,
  readPrivateLiquidityHiddenIntentOwnerPage,
  submitPrivateLiquidityHiddenIntentAction,
  submitPrivateLiquidityHiddenIntentSettlement
} from './privateLiquidityActions';
import {
  buildPrivateLiquidityHiddenIntentSettlementRoutes,
  preparePrivateLiquidityHiddenIntent
} from './privateLiquidityHiddenIntents';
import type {
  AttestedPrivateLiquidityDeployment,
  CompleteCanonicalPrivateLiquidityPositionSnapshot
} from './privateLiquidityChain';
import { buildPrivateLiquidityPairKey } from './privateLiquidity';

const address = (pair: string): string => `0x${pair.repeat(20)}`;
const hash = (pair: string): string => `0x${pair.repeat(32)}`;
const CHAIN_ID = 7_082_400n;
const BOOK = address('11');
const OWNER = address('22');
const BASE = address('33');
const QUOTE = address('44');
const TX_HASH = hash('aa');
const BLOCK_HASH = hash('bb');
const ABI = new Interface(PRIVATE_LIQUIDITY_ACTION_ABI);

const deployment = Object.freeze({
  chainId: CHAIN_ID.toString(),
  contractAddress: BOOK,
  deploymentBlock: '100',
  runtimeBytecodeHash: hash('cc'),
  contractVersion: 'ChainWhisperPrivateLiquidityBookV2',
  requiredFeatures: Object.freeze([]),
  finalityLagBlocks: '5',
  attestationBlock: Object.freeze({ number: '120', hash: BLOCK_HASH })
}) as unknown as AttestedPrivateLiquidityDeployment;

const browserProvider = (
  fallback?: (method: string, params: readonly unknown[]) => Promise<unknown>
) => new BrowserProvider({
  request: vi.fn(async ({ method, params = [] }: { method: string; params?: readonly unknown[] }) => {
    if (method === 'eth_chainId') return `0x${CHAIN_ID.toString(16)}`;
    if (method === 'eth_accounts') return [OWNER];
    if (fallback) return fallback(method, params);
    return null;
  })
}, { chainId: Number(CHAIN_ID), name: 'Hidden intent test' });

const setupCapability = async (
  fallback?: (method: string, params: readonly unknown[]) => Promise<unknown>
) => {
  const provider = browserProvider(fallback);
  const signer = {
    provider,
    getAddress: vi.fn(async () => OWNER),
    sendUncheckedTransaction: vi.fn(),
    getUserOnboardInfo: vi.fn(() => ({ aesKey: 'test-aes' })),
    decryptValue: vi.fn(async (value: { ciphertextHigh?: bigint }) => value.ciphertextHigh ?? 0n)
  } as unknown as JsonRpcSigner;
  return {
    signer,
    capability: await bindPrivateLiquidityMetaMaskCapability({
      signer,
      browserProvider: provider,
      ownerAddress: OWNER,
      chainId: CHAIN_ID,
      assertCurrent: () => undefined
    })
  };
};

describe('privateLiquidityHiddenIntentActions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.decryptPrivateUint256Output.mockImplementation((
      _signer: unknown,
      ciphertext: { ciphertextHigh: bigint }
    ) => ciphertext.ciphertextHigh);
    mocks.encryptPrivateUint256Input
      .mockResolvedValueOnce({ ciphertext: { ciphertextHigh: 1n, ciphertextLow: 2n }, signature: '0x12' })
      .mockResolvedValueOnce({ ciphertext: { ciphertextHigh: 3n, ciphertextLow: 4n }, signature: '0x34' });
  });

  it('uses exactly two packed private inputs and confirms the exact opened marker', async () => {
    const { capability, signer } = await setupCapability();
    const prepared = preparePrivateLiquidityHiddenIntent({
      baseToken: BASE,
      quoteToken: QUOTE,
      side: 'sell-base',
      limitTerms: { baseAmount: '1', quoteAmount: '12' },
      maximumBudget: 500n,
      minimumFill: 100n,
      cooldownBlocks: 7n,
      expiresAt: 2_000n,
      currentTimestamp: 1_000n
    });
    const createHiddenIntent = vi.fn(async (...args: unknown[]) => {
      const data = ABI.encodeFunctionData('createHiddenIntent', args.slice(0, -1)).toLowerCase();
      const event = ABI.getEvent('PrivateLiquidityHiddenIntentOpened');
      if (!event) throw new Error('Missing event.');
      const encoded = ABI.encodeEventLog(event, [
        9n,
        OWNER,
        prepared.pairKey,
        BASE,
        QUOTE,
        1_100n,
        2_000n,
        7n
      ]);
      return {
        hash: TX_HASH,
        chainId: CHAIN_ID,
        from: OWNER,
        to: BOOK,
        data,
        value: 0n,
        wait: vi.fn(async () => ({
          status: 1n,
          transactionHash: TX_HASH,
          blockNumber: 130n,
          blockHash: BLOCK_HASH,
          logs: [{
            address: BOOK,
            topics: encoded.topics,
            data: encoded.data,
            transactionHash: TX_HASH,
            blockNumber: 130n,
            blockHash: BLOCK_HASH,
            logIndex: 2,
            removed: false
          }]
        }))
      };
    });
    mocks.loadCotiEthersModule.mockResolvedValue({
      Contract: vi.fn(function MockContract() { return { createHiddenIntent }; })
    });

    const submission = await submitPrivateLiquidityHiddenIntentAction({
      capability,
      deployment,
      action: { kind: 'create-hidden-intent', prepared }
    });
    const confirmed = await confirmPrivateLiquidityHiddenIntentAction({
      capability,
      deployment,
      submission
    });

    expect(mocks.encryptPrivateUint256Input).toHaveBeenNthCalledWith(
      1,
      signer,
      BigInt(prepared.privateTermsPlaintext),
      BOOK,
      PRIVATE_LIQUIDITY_CREATE_HIDDEN_INTENT_SELECTOR
    );
    expect(mocks.encryptPrivateUint256Input).toHaveBeenNthCalledWith(
      2,
      signer,
      BigInt(prepared.privateBudgetPlaintext),
      BOOK,
      PRIVATE_LIQUIDITY_CREATE_HIDDEN_INTENT_SELECTOR
    );
    expect(createHiddenIntent).toHaveBeenCalledOnce();
    const createCall = createHiddenIntent.mock.calls[0] ?? [];
    expect(createCall[createCall.length - 1]).toEqual({
      gasLimit: PRIVATE_LIQUIDITY_ACTION_GAS_LIMIT
    });
    expect(confirmed).toMatchObject({
      action: 'create-hidden-intent',
      intentId: '9',
      submittedTransactionHash: TX_HASH,
      transactionHash: TX_HASH,
      blockNumber: '130',
      blockHash: BLOCK_HASH,
      logIndex: 2
    });
  });

  it('rejects V1 deployments and structurally forged prepared drafts before encryption', async () => {
    const { capability } = await setupCapability();
    await expect(submitPrivateLiquidityHiddenIntentAction({
      capability,
      deployment: { ...deployment, contractVersion: 'ChainWhisperPrivateLiquidityBookV1' },
      action: {
        kind: 'create-hidden-intent',
        prepared: {} as never
      }
    })).rejects.toThrow(/exactly attested Private Liquidity V2/);
    await expect(submitPrivateLiquidityHiddenIntentAction({
      capability,
      deployment,
      action: {
        kind: 'create-hidden-intent',
        prepared: {} as never
      }
    })).rejects.toThrow(/exact locally prepared/);
    expect(mocks.encryptPrivateUint256Input).not.toHaveBeenCalled();
  });

  it('cancels an owner intent with one ordinary transaction and no private input', async () => {
    const { capability } = await setupCapability();
    const cancelHiddenIntent = vi.fn(async (intentId: bigint, _overrides: unknown) => {
      const data = ABI.encodeFunctionData('cancelHiddenIntent', [intentId]).toLowerCase();
      const event = ABI.getEvent('PrivateLiquidityHiddenIntentCancelled');
      if (!event) throw new Error('Missing event.');
      const encoded = ABI.encodeEventLog(event, [intentId, OWNER]);
      return {
        hash: TX_HASH,
        chainId: CHAIN_ID,
        from: OWNER,
        to: BOOK,
        data,
        value: 0n,
        wait: vi.fn(async () => ({
          status: 1n,
          transactionHash: TX_HASH,
          blockNumber: 131n,
          blockHash: BLOCK_HASH,
          logs: [{
            address: BOOK,
            topics: encoded.topics,
            data: encoded.data,
            transactionHash: TX_HASH,
            blockNumber: 131n,
            blockHash: BLOCK_HASH,
            logIndex: 3,
            removed: false
          }]
        }))
      };
    });
    mocks.loadCotiEthersModule.mockResolvedValue({
      Contract: vi.fn(function MockContract() { return { cancelHiddenIntent }; })
    });

    const submission = await submitPrivateLiquidityHiddenIntentAction({
      capability,
      deployment,
      action: { kind: 'cancel-hidden-intent', intentId: 9n }
    });
    const confirmed = await confirmPrivateLiquidityHiddenIntentAction({
      capability,
      deployment,
      submission
    });

    expect(mocks.encryptPrivateUint256Input).not.toHaveBeenCalled();
    expect(cancelHiddenIntent).toHaveBeenCalledWith(
      9n,
      { gasLimit: PRIVATE_LIQUIDITY_ACTION_GAS_LIMIT }
    );
    expect(confirmed).toMatchObject({
      action: 'cancel-hidden-intent',
      intentId: '9',
      blockNumber: '131',
      logIndex: 3
    });
  });

  it('reads a block-pinned owner page and decrypts only the connected owner receipts', async () => {
    const prepared = preparePrivateLiquidityHiddenIntent({
      baseToken: BASE,
      quoteToken: QUOTE,
      side: 'sell-base',
      limitTerms: { baseAmount: '1000000', quoteAmount: '12000000' },
      maximumBudget: 500000000n,
      minimumFill: 100000000n,
      cooldownBlocks: 7n,
      expiresAt: 2_000n,
      currentTimestamp: 1_000n
    });
    const selfChecking = (amount: bigint) => (amount << 128n) + ((1n << 128n) - 1n - amount);
    const ut = (value: bigint) => [[1n, 2n], [value, 0n]];
    const fallback = vi.fn(async (method: string, params: readonly unknown[]) => {
      if (method !== 'eth_call') throw new Error(`Unexpected ${method}`);
      const call = params[0] as { data: string };
      const parsed = ABI.parseTransaction({ data: call.data });
      if (!parsed) throw new Error('Unknown call.');
      if (parsed.name === 'hiddenIntentCountForOwner') {
        return ABI.encodeFunctionResult(parsed.name, [1n]);
      }
      if (parsed.name === 'getHiddenIntentIdsForOwner') {
        return ABI.encodeFunctionResult(parsed.name, [[9n], 0n]);
      }
      if (parsed.name === 'getHiddenIntentView') {
        return ABI.encodeFunctionResult(parsed.name, [[
          [1, OWNER, BASE, QUOTE, hash('01'), hash('02'), 1_000n, 2_000n, 7, 2],
          buildPrivateLiquidityPairKey(BASE, QUOTE),
          129n,
          128n,
          true
        ]]);
      }
      if (parsed.name === 'getHiddenIntentOwnerReceipt') {
        return ABI.encodeFunctionResult(parsed.name, [[
          OWNER,
          3n,
          true,
          ut(BigInt(prepared.privateTermsPlaintext)),
          ut(BigInt(prepared.privateBudgetPlaintext)),
          ut(selfChecking(200000000n)),
          ut(selfChecking(2400000000n))
        ]]);
      }
      throw new Error(`Unexpected getter ${parsed.name}`);
    });
    const { capability, signer } = await setupCapability(fallback);

    const page = await readPrivateLiquidityHiddenIntentOwnerPage({
      capability,
      deployment,
      atBlock: { number: '130', hash: BLOCK_HASH }
    });

    expect(page).toMatchObject({
      totalCount: '1',
      nextOffset: '0',
      atBlock: { number: '130', hash: BLOCK_HASH }
    });
    expect(page.items[0]).toMatchObject({
      view: { intentId: '9', status: 'open', owner: OWNER, fillCount: '2' },
      receipt: {
        intentId: '9',
        side: 'sell-base',
        remainingBudget: '500000000',
        minimumFill: '100000000',
        lastInputAmount: '200000000',
        lastOutputAmount: '2400000000'
      }
    });
    expect(mocks.decryptPrivateUint256Output).toHaveBeenCalledTimes(4);
    expect(signer.decryptValue).not.toHaveBeenCalled();
    expect(fallback).toHaveBeenCalled();
  });

  it('settles only a complete branded pair route after a block-pinned nonempty-queue preflight', async () => {
    const pairKey = buildPrivateLiquidityPairKey(BASE, QUOTE);
    const snapshot = Object.freeze({
      scope: Object.freeze({ chainId: CHAIN_ID.toString(), contractAddress: BOOK, deploymentBlock: '100' }),
      atBlock: Object.freeze({ number: '130', hash: BLOCK_HASH }),
      positionCount: '1',
      positions: Object.freeze([Object.freeze({
        identity: Object.freeze({ chainId: CHAIN_ID.toString(), contractAddress: BOOK, positionId: '7' }),
        owner: OWNER,
        pairKey,
        baseToken: BASE,
        quoteToken: QUOTE,
        buyTerms: Object.freeze({ baseAmount: '1000000', quoteAmount: '11000000' }),
        sellTerms: Object.freeze({ baseAmount: '1000000', quoteAmount: '12000000' }),
        status: 'active' as const,
        revision: '4',
        buySideAvailable: true,
        sellSideAvailable: true,
        privacyOwner: OWNER,
        createdAt: '1000',
        lastActivityBlock: '129'
      })])
    }) as unknown as CompleteCanonicalPrivateLiquidityPositionSnapshot;
    const routes = buildPrivateLiquidityHiddenIntentSettlementRoutes({
      snapshot,
      baseToken: BASE,
      quoteToken: QUOTE
    });
    const fallback = vi.fn(async (method: string, params: readonly unknown[]) => {
      if (method !== 'eth_call') throw new Error(`Unexpected ${method}`);
      const call = params[0] as { data: string };
      const parsed = ABI.parseTransaction({ data: call.data });
      if (!parsed) throw new Error('Unknown call.');
      if (parsed.name === 'openHiddenIntentCountByPair') {
        return ABI.encodeFunctionResult(parsed.name, [3n]);
      }
      if (parsed.name === 'hiddenIntentCursorByPair') {
        return ABI.encodeFunctionResult(parsed.name, [1n]);
      }
      throw new Error(`Unexpected getter ${parsed.name}`);
    });
    const { capability } = await setupCapability(fallback);
    const settleHiddenIntents = vi.fn(async (...args: unknown[]) => {
      const data = ABI.encodeFunctionData('settleHiddenIntents', args.slice(0, -1)).toLowerCase();
      const event = ABI.getEvent('PrivateLiquidityHiddenIntentSettlementProcessed');
      if (!event) throw new Error('Missing event.');
      const encoded = ABI.encodeEventLog(event, [12n, pairKey, OWNER, 3n, 1n]);
      return {
        hash: TX_HASH,
        chainId: CHAIN_ID,
        from: OWNER,
        to: BOOK,
        data,
        value: 0n,
        wait: vi.fn(async () => ({
          status: 1n,
          transactionHash: TX_HASH,
          blockNumber: 131n,
          blockHash: BLOCK_HASH,
          logs: [{
            address: BOOK,
            topics: encoded.topics,
            data: encoded.data,
            transactionHash: TX_HASH,
            blockNumber: 131n,
            blockHash: BLOCK_HASH,
            logIndex: 4,
            removed: false
          }]
        }))
      };
    });
    mocks.loadCotiEthersModule.mockResolvedValue({
      Contract: vi.fn(function MockContract() { return { settleHiddenIntents }; })
    });

    const pairStatus = await readPrivateLiquidityHiddenIntentPairStatus({
      capability,
      deployment,
      pairKey,
      atBlock: snapshot.atBlock
    });
    const submission = await submitPrivateLiquidityHiddenIntentSettlement({
      capability,
      deployment,
      routes,
      deadline: 2_000n
    });
    const confirmed = await confirmPrivateLiquidityHiddenIntentSettlement({
      capability,
      deployment,
      submission
    });

    expect(pairStatus).toMatchObject({ openIntentCount: '3', cursor: '1', atBlock: snapshot.atBlock });
    expect(settleHiddenIntents).toHaveBeenCalledWith(
      pairKey,
      [7n],
      [4n],
      [7n],
      [4n],
      2_000n,
      { gasLimit: PRIVATE_LIQUIDITY_ACTION_GAS_LIMIT }
    );
    expect(mocks.encryptPrivateUint256Input).not.toHaveBeenCalled();
    expect(confirmed).toMatchObject({
      settlementId: '12',
      pairKey,
      caller: OWNER,
      processedIntentCount: 3,
      candidateCount: 1,
      transactionHash: TX_HASH,
      blockNumber: '131',
      logIndex: 4
    });
    await expect(submitPrivateLiquidityHiddenIntentSettlement({
      capability,
      deployment,
      routes: { ...routes } as never,
      deadline: 2_000n
    })).rejects.toThrow(/exact routes derived from a complete canonical snapshot/);
  });
});
