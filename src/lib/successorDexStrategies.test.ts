import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  admission: vi.fn(),
  encrypt: vi.fn(async (_signer: unknown, { plaintext }: { plaintext: bigint; contractAddress: string; functionSelector: string }) => ({ ciphertext: plaintext, signature: '0x01' })),
  ensureTradeTokenAllowance: vi.fn(),
  getFunction: vi.fn()
}));

vi.mock('./appChain', () => ({ ensureTradeTokenAllowance: mocks.ensureTradeTokenAllowance }));
vi.mock('./authenticatedUint64', () => ({ encryptAuthenticatedUint64Input: mocks.encrypt }));
vi.mock('@coti-io/coti-ethers', async () => {
  const actual = await vi.importActual<typeof import('@coti-io/coti-ethers')>('@coti-io/coti-ethers');
  return {
    ...actual,
    Contract: class {
      readonly interface = { getFunction: () => ({ selector: '0x12345678' }) };

      getFunction(method: string) {
        mocks.getFunction(method);
        return async (...args: unknown[]) => {
          mocks.admission(method, args);
          return { hash: `0x${'aa'.repeat(32)}`, wait: async () => ({ status: 1, logs: [] }) };
        };
      }
    }
  };
});

import {
  buildAggregatePolicy,
  createSuccessorStrategy,
  successorStrategyPriceQToDisplayedPrice
} from './successorDexStrategies';
import type { SuccessorDexManifest, SuccessorDexPair } from './successorDexDeployment';

const BCN = '0x0000000000000000000000000000000000000001';
const HBR = '0x0000000000000000000000000000000000000002';
const AUTHORITY = '0x0000000000000000000000000000000000000003';
const CORE = '0x0000000000000000000000000000000000000004';
const NFT = '0x0000000000000000000000000000000000000005';
const OWNER = '0x0000000000000000000000000000000000000006';
const RECURRING_HOST = '0x0000000000000000000000000000000000000007';
const RECURRING_ADAPTER = '0x0000000000000000000000000000000000000008';

const manifestWithLots = (bcnLotSizeRaw: string, hbrLotSizeRaw: string) => ({
  contracts: {
    'work-authority': { address: AUTHORITY },
    'spb-bcn-hbr-recurring-host': {
      address: RECURRING_HOST,
      contractName: 'ChainWhisperUnifiedInventoryRecurringOrderHostV0'
    },
    'spb-bcn-hbr-recurring-adapter': {
      address: RECURRING_ADAPTER,
      contractName: 'ChainWhisperUnifiedInventoryPrivateBookRecurringAdapterV0'
    }
  },
  globalCore: CORE,
  positionNFT: NFT,
  tokens: [
    { address: BCN, decimals: 6, lotSizeRaw: bcnLotSizeRaw, symbol: 'BCN' },
    { address: HBR, decimals: 6, lotSizeRaw: hbrLotSizeRaw, symbol: 'HBR' }
  ]
}) as unknown as SuccessorDexManifest;

const manifest = manifestWithLots('1000000', '1000000');

const pair = (token0: string, token1: string): SuccessorDexPair => ({
  admissionAdapters: {
    Recurring: {
      adapterRoleKey: 'spb-bcn-hbr-recurring-adapter',
      bridgeRoleKey: 'spb-bcn-hbr-recurring-bridge',
      capacityModel: 'reusable-single-active-slot',
      sourceId: 1
    }
  },
  coordinator: null,
  displayPair: 'BCN/HBR',
  epochController: null,
  marketKey: `0x${'11'.repeat(32)}`,
  readiness: 'seeded',
  seedProfile: 'direct',
  sourceCount: 1,
  strategies: ['Aggregate'],
  token0,
  token1
});

describe('successor Aggregate policy', () => {
  beforeEach(() => {
    mocks.admission.mockClear();
    mocks.encrypt.mockClear();
    mocks.ensureTradeTokenAllowance.mockClear();
    mocks.getFunction.mockClear();
  });

  it('keeps displayed and address-canonical price orientation exact', () => {
    const reversed = buildAggregatePolicy({
      manifest,
      pair: pair(HBR, BCN),
      amount0: 900n,
      amount1: 900n,
      startingPrice: 2,
      totalSpreadPercent: 0.3
    });
    expect(reversed.priceQ).toBe(50_000_000n);
    expect(reversed.spreadFactorPpm).toBe(1_001_499n);
    expect(reversed.policy).toEqual([2_700n, 900n, 1_001_499n, 0n, 1_048_575n, 0n, 1_048_575n]);

    const forward = buildAggregatePolicy({
      manifest,
      pair: pair(BCN, HBR),
      amount0: 900n,
      amount1: 900n,
      startingPrice: 2,
      totalSpreadPercent: 0
    });
    expect(forward.priceQ).toBe(200_000_000n);
    expect(forward.spreadFactorPpm).toBe(1_000_000n);
    expect(forward.policy.slice(0, 3)).toEqual([900n, 2_700n, 1_000_000n]);
    expect(forward.laneMode).toBe(1n);
    expect(forward.target).toBe(0n);
  });

  it('encodes human prices in the canonical token0/token1 lot units', () => {
    const unequalLots = manifestWithLots('250000', '1000000');
    const forward = buildAggregatePolicy({
      manifest: unequalLots,
      pair: pair(BCN, HBR),
      amount0: 4n,
      amount1: 1n,
      startingPrice: 2,
      totalSpreadPercent: 0
    });
    expect(forward.priceQ).toBe(50_000_000n);
    expect(successorStrategyPriceQToDisplayedPrice(unequalLots, pair(BCN, HBR), 'BCN', forward.priceQ)).toBe(2);
    const reversed = buildAggregatePolicy({
      manifest: unequalLots,
      pair: pair(HBR, BCN),
      amount0: 1n,
      amount1: 4n,
      startingPrice: 2,
      totalSpreadPercent: 0
    });
    expect(reversed.priceQ).toBe(200_000_000n);
    expect(successorStrategyPriceQToDisplayedPrice(unequalLots, pair(HBR, BCN), 'BCN', reversed.priceQ)).toBe(2);
  });

  it('scales every corrected family allowance by that token lot size and calls getFunction', async () => {
    const unequalLots = manifestWithLots('250000', '1000000');
    const selectedPair = pair(BCN, HBR);
    const signer = { getAddress: vi.fn(async () => OWNER) } as never;
    const missingMint = 'Position NFT mint was not found';

    await expect(createSuccessorStrategy({
      signer,
      manifest: unequalLots,
      request: {
        family: 'Aggregate',
        pair: selectedPair,
        amountBySymbol: { BCN: '0.5', HBR: '3' },
        startingPrice: 2,
        totalSpreadPercent: 0
      }
    })).rejects.toThrow(missingMint);
    await expect(createSuccessorStrategy({
      signer,
      manifest: unequalLots,
      request: { family: 'Fixed', pair: selectedPair, soldSymbol: 'HBR', inventory: '4', price: 2, minimumOutputPercent: 25 }
    })).rejects.toThrow(missingMint);
    await expect(createSuccessorStrategy({
      signer,
      manifest: unequalLots,
      request: {
        family: 'Range',
        pair: selectedPair,
        soldSymbol: 'HBR',
        inventory: '2',
        startPrice: 2,
        endPrice: 2.2,
        minimumOutputPercent: 50
      }
    })).rejects.toThrow(missingMint);
    await expect(createSuccessorStrategy({
      signer,
      manifest: unequalLots,
      request: {
        family: 'Recurring',
        recurringClass: 'LL',
        pair: selectedPair,
        baseSymbol: 'BCN',
        quoteSymbol: 'HBR',
        baseInventory: '1.25',
        quoteInventory: '6',
        buyPrice: 1.9,
        sellPrice: 2.1
      }
    })).rejects.toThrow(missingMint);

    expect(mocks.ensureTradeTokenAllowance.mock.calls).toEqual([
      [signer, OWNER, BCN, 500_000n, 'private-erc20', CORE],
      [signer, OWNER, HBR, 3_000_000n, 'private-erc20', CORE],
      [signer, OWNER, HBR, 4_000_000n, 'private-erc20', CORE],
      [signer, OWNER, HBR, 2_000_000n, 'private-erc20', CORE],
      [signer, OWNER, BCN, 1_250_000n, 'private-erc20', CORE],
      [signer, OWNER, HBR, 6_000_000n, 'private-erc20', CORE]
    ]);
    expect(mocks.getFunction.mock.calls.map(([method]) => method)).toEqual([
      'admitPosition',
      'admitFixedLimit',
      'admitRange',
      'admitRecurringLl'
    ]);
  });

  it('encodes RR as six encrypted pairs and binds its inputs to the validating host', async () => {
    const signer = { getAddress: vi.fn(async () => OWNER) } as never;
    await expect(createSuccessorStrategy({
      signer,
      manifest: manifestWithLots('250000', '1000000'),
      request: {
        family: 'Recurring',
        recurringClass: 'RR',
        pair: pair(BCN, HBR),
        baseSymbol: 'BCN',
        quoteSymbol: 'HBR',
        baseInventory: '1.25',
        quoteInventory: '6',
        buyPrice: 1.9,
        buyEndPrice: 2,
        sellPrice: 2.1,
        sellEndPrice: 2
      }
    })).rejects.toThrow('Position NFT mint was not found');

    expect(mocks.getFunction).toHaveBeenCalledWith('admitRecurringRr');
    expect(mocks.ensureTradeTokenAllowance.mock.calls).toEqual([
      [signer, OWNER, BCN, 1_250_000n, 'private-erc20', CORE],
      [signer, OWNER, HBR, 6_000_000n, 'private-erc20', CORE]
    ]);
    expect(mocks.encrypt).toHaveBeenCalledTimes(15);
    expect(mocks.encrypt.mock.calls.every(([, input]) =>
      input.contractAddress === RECURRING_HOST && input.functionSelector !== '0x12345678'
    )).toBe(true);
    const [method, args] = mocks.admission.mock.calls[0] as [string, unknown[]];
    expect(method).toBe('admitRecurringRr');
    expect((args.slice(2, 8) as { ciphertext: bigint }[][]).map((values) =>
      values.map(({ ciphertext }) => ciphertext)
    )).toEqual([
      [95_000_001n, 105_000_000n],
      [50_000_000n, 50_000_000n],
      [1n, 1n],
      [5n, 6n],
      [0n, 0n],
      [1n, 1n]
    ]);
    expect((args.slice(8, 11) as { ciphertext: bigint }[]).map(({ ciphertext }) => ciphertext))
      .toEqual([0n, 0n, 0n]);
  });

  it('keeps one human token equal to one lot for the current equal-size profile', async () => {
    const signer = { getAddress: vi.fn(async () => OWNER) } as never;
    await expect(createSuccessorStrategy({
      signer,
      manifest,
      request: {
        family: 'Fixed',
        pair: pair(BCN, HBR),
        soldSymbol: 'BCN',
        inventory: '4',
        price: 2,
        minimumOutputPercent: 0
      }
    })).rejects.toThrow('Position NFT mint was not found');
    expect(mocks.ensureTradeTokenAllowance).toHaveBeenCalledWith(
      signer,
      OWNER,
      BCN,
      4_000_000n,
      'private-erc20',
      CORE
    );
  });

  it('rejects human amounts that are not exact token lot multiples', async () => {
    const signer = { getAddress: vi.fn(async () => OWNER) } as never;
    await expect(createSuccessorStrategy({
      signer,
      manifest: manifestWithLots('250000', '1000000'),
      request: {
        family: 'Aggregate',
        pair: pair(BCN, HBR),
        amountBySymbol: { BCN: '0.1', HBR: '1' },
        startingPrice: 2,
        totalSpreadPercent: 0
      }
    })).rejects.toThrow('exact settlement-lot multiple');
    expect(mocks.ensureTradeTokenAllowance).not.toHaveBeenCalled();
    expect(mocks.getFunction).not.toHaveBeenCalled();
  });

  it('rejects an invalid Range direction before token approval', async () => {
    const signer = { getAddress: vi.fn(async () => OWNER) } as never;
    await expect(createSuccessorStrategy({
      signer,
      manifest: manifestWithLots('250000', '1000000'),
      request: {
        family: 'Range',
        pair: pair(BCN, HBR),
        soldSymbol: 'HBR',
        inventory: '2',
        startPrice: 2,
        endPrice: 1.8,
        minimumOutputPercent: 25
      }
    })).rejects.toThrow('wrong direction');
    expect(mocks.ensureTradeTokenAllowance).not.toHaveBeenCalled();
  });

  it('rejects an invalid RR boundary before token approval', async () => {
    const signer = { getAddress: vi.fn(async () => OWNER) } as never;
    await expect(createSuccessorStrategy({
      signer,
      manifest: manifestWithLots('250000', '1000000'),
      request: {
        family: 'Recurring',
        recurringClass: 'RR',
        pair: pair(BCN, HBR),
        baseSymbol: 'BCN',
        quoteSymbol: 'HBR',
        baseInventory: '1.25',
        quoteInventory: '6',
        buyPrice: 1.9,
        buyEndPrice: 1.8,
        sellPrice: 2.1,
        sellEndPrice: 2
      }
    })).rejects.toThrow('wrong direction');
    expect(mocks.ensureTradeTokenAllowance).not.toHaveBeenCalled();
    expect(mocks.encrypt).not.toHaveBeenCalled();
  });

  it('rejects invalid spread and effective-inventory overflow', () => {
    const base = { manifest, pair: pair(BCN, HBR), amount0: 900n, amount1: 900n, startingPrice: 2 };
    expect(() => buildAggregatePolicy({ ...base, totalSpreadPercent: -0.01 })).toThrow('between 0% and 20%');
    expect(() => buildAggregatePolicy({ ...base, totalSpreadPercent: 20.01 })).toThrow('between 0% and 20%');
    expect(() => buildAggregatePolicy({ ...base, startingPrice: 2_000_000, totalSpreadPercent: 0.3 })).toThrow('effective-inventory domain');
  });
});
