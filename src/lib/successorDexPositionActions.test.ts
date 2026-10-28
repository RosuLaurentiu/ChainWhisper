import { AbiCoder, Interface } from '@coti-io/coti-ethers';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  contractCall: vi.fn(),
  encrypt: vi.fn(async (_signer: unknown, input: { contractAddress: string; functionSelector: string; plaintext: bigint }) => ({ ciphertext: input.plaintext, signature: '0x01' })),
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
      getFunction(method: string) {
        mocks.getFunction(method);
        return async (...args: unknown[]) => {
          mocks.contractCall(method, args);
          return { hash: `0x${'aa'.repeat(32)}`, wait: async () => ({ status: 1 }) };
        };
      }
    }
  };
});
import {
  decodeSuccessorFixedPositionTerms,
  decodeSuccessorRangePositionTerms,
  submitSuccessorPositionEdit,
  submitSuccessorPositionTransfer
} from './successorDexPositionActions';
import type { SuccessorDexManifest } from './successorDexDeployment';

const coder = AbiCoder.defaultAbiCoder();
const BCN = '0x0000000000000000000000000000000000000001';
const HBR = '0x0000000000000000000000000000000000000002';
const AUTHORITY = '0x0000000000000000000000000000000000000003';
const CORE = '0x0000000000000000000000000000000000000004';
const FIXED_HOST = '0x0000000000000000000000000000000000000005';
const RANGE_HOST = '0x0000000000000000000000000000000000000006';
const OWNER = '0x0000000000000000000000000000000000000007';
const POSITION_NFT = '0x0000000000000000000000000000000000000009';
const AGGREGATE_HOST = '0x000000000000000000000000000000000000000a';
const RECURRING_HOST = '0x000000000000000000000000000000000000000b';
const MARKET = `0x${'11'.repeat(32)}`;
const manifest = {
  contracts: {
    'work-authority': { address: AUTHORITY },
    'spb-bcn-hbr-fixed-host': { address: FIXED_HOST },
    'spb-bcn-hbr-range-host': { address: RANGE_HOST },
    'spb-bcn-hbr-aggregate-host': { address: AGGREGATE_HOST },
    'spb-bcn-hbr-recurring-host': { address: RECURRING_HOST }
  },
  globalCore: CORE,
  positionNFT: POSITION_NFT,
  pairs: [{
    admissionAdapters: {
      Aggregate: { adapterRoleKey: 'spb-bcn-hbr-aggregate-adapter' },
      Fixed: { adapterRoleKey: 'spb-bcn-hbr-fixed-adapter' },
      Range: { adapterRoleKey: 'spb-bcn-hbr-range-adapter' },
      Recurring: { adapterRoleKey: 'spb-bcn-hbr-recurring-adapter' }
    },
    displayPair: 'BCN/HBR', marketKey: MARKET, token0: BCN, token1: HBR
  }],
  tokens: [
    { address: BCN, decimals: 6, lotSizeRaw: '250000', symbol: 'BCN' },
    { address: HBR, decimals: 6, lotSizeRaw: '1000000', symbol: 'HBR' }
  ]
} as unknown as SuccessorDexManifest;

const payload = (values: readonly bigint[]) => coder.encode(
  ['tuple(uint256[5] userCiphertexts,uint64 revision,uint64 actionCount)'],
  [[values, 4n, 7n]]
);

describe('decodeSuccessorFixedPositionTerms', () => {
  beforeEach(() => {
    mocks.contractCall.mockClear();
    mocks.encrypt.mockClear();
    mocks.ensureTradeTokenAllowance.mockClear();
    mocks.getFunction.mockClear();
  });
  it('decodes only owner user ciphertexts and preserves the corrected Fixed payload', () => {
    const terms = decodeSuccessorFixedPositionTerms({
      encoded: payload([1_000n, 200_000_000n + 1_000n, 4_000n, 6_000n, 2_000n]),
      positionId: '9',
      decrypt: (value) => value - 1_000n
    });

    expect(terms).toEqual({
      actionCount: 7,
      family: 'Fixed',
      inventory0Lots: 3_000n,
      inventory1Lots: 5_000n,
      minimumOutputLots: 1_000n,
      positionId: '9',
      priceQ: 200_000_000n,
      revision: 4,
      side: 0
    });
  });

  it('decodes the kind-derived Range payload through the same owner endpoint', () => {
    const encoded = coder.encode(
      ['tuple(uint256[7] userCiphertexts,uint64 revision,uint64 actionCount)'],
      [[[1n, 100_000_000n, 125_000_000n, 8n, 3n, 5n, 2n], 6n, 9n]]
    );

    expect(decodeSuccessorRangePositionTerms({
      decrypt: (value) => value,
      encoded,
      positionId: '11'
    })).toEqual({
      actionCount: 9,
      endPriceQ: 125_000_000n,
      family: 'Range',
      initialOutputLots: 8n,
      inventory0Lots: 3n,
      inventory1Lots: 5n,
      minimumOutputLots: 2n,
      positionId: '11',
      revision: 6,
      side: 1,
      startPriceQ: 100_000_000n
    });
  });

  it('rejects a decrypted payload outside the Fixed contract domain', () => {
    expect(() => decodeSuccessorFixedPositionTerms({
      encoded: payload([2n, 100_000_000n, 1n, 0n, 0n]),
      positionId: '1',
      decrypt: (value) => value
    })).toThrow('failed validation');
  });

  it('rejects Range terms with an invalid side curve or offered inventory', () => {
    const rangePayload = (values: readonly bigint[]) => coder.encode(
      ['tuple(uint256[7] userCiphertexts,uint64 revision,uint64 actionCount)'],
      [[values, 4n, 7n]]
    );
    expect(() => decodeSuccessorRangePositionTerms({
      encoded: rangePayload([0n, 50n, 60n, 4n, 4n, 0n, 0n]),
      positionId: '1', decrypt: (value) => value
    })).toThrow('failed validation');
    expect(() => decodeSuccessorRangePositionTerms({
      encoded: rangePayload([1n, 50n, 60n, 4n, 0n, 5n, 0n]),
      positionId: '1', decrypt: (value) => value
    })).toThrow('failed validation');
  });

  it('top-ups Fixed and Range through host-bound ciphertext and token-specific raw allowances', async () => {
    const signer = { getAddress: vi.fn(async () => OWNER) } as never;
    const common = { marketKey: MARKET, owner: OWNER, ownershipRevision: 2, positionId: '9' } as const;
    const fixedTerms = {
      actionCount: 4, family: 'Fixed' as const, inventory0Lots: 3n, inventory1Lots: 0n,
      minimumOutputLots: 1n, positionId: '9', priceQ: 50_000_000n, revision: 5, side: 0 as const
    };
    await submitSuccessorPositionEdit({
      edit: { kind: 'top-up', amount: '0.5' }, manifest,
      position: { ...common, family: 'Fixed' }, privateTerms: fixedTerms, signer
    });
    const rangeTerms = {
      actionCount: 4, endPriceQ: 40_000_000n, family: 'Range' as const, initialOutputLots: 3n,
      inventory0Lots: 0n, inventory1Lots: 3n, minimumOutputLots: 1n, positionId: '9',
      revision: 6, side: 1 as const, startPriceQ: 50_000_000n
    };
    await submitSuccessorPositionEdit({
      edit: { kind: 'top-up', amount: '2' }, manifest,
      position: { ...common, family: 'Range' }, privateTerms: rangeTerms, signer
    });

    expect(mocks.ensureTradeTokenAllowance.mock.calls).toEqual([
      [signer, OWNER, BCN, 500_000n, 'private-erc20', CORE],
      [signer, OWNER, HBR, 2_000_000n, 'private-erc20', CORE]
    ]);
    expect(mocks.contractCall.mock.calls.map(([method]) => method)).toEqual(['topUpFixedLimit', 'topUpRange']);
    const host = new Interface([
      'function topUpFixedLimit(uint256,uint64,(uint256,bytes))',
      'function topUpRange(uint256,uint64,(uint256,bytes))'
    ]);
    expect(mocks.encrypt.mock.calls[0][1]).toMatchObject({
      contractAddress: FIXED_HOST,
      functionSelector: host.getFunction('topUpFixedLimit')!.selector,
      plaintext: 2n
    });
    expect(mocks.encrypt.mock.calls[1][1]).toMatchObject({
      contractAddress: RANGE_HOST,
      functionSelector: host.getFunction('topUpRange')!.selector,
      plaintext: 2n
    });
    expect(mocks.encrypt.mock.invocationCallOrder[0]).toBeLessThan(mocks.ensureTradeTokenAllowance.mock.invocationCallOrder[0]);
  });

  it('reprices Fixed and Range with immutable side, lot-ratio prices, and current revisions', async () => {
    const signer = { getAddress: vi.fn(async () => OWNER) } as never;
    const common = { marketKey: MARKET, owner: OWNER, ownershipRevision: 2, positionId: '9' } as const;
    const fixedTerms = {
      actionCount: 4, family: 'Fixed' as const, inventory0Lots: 3n, inventory1Lots: 0n,
      minimumOutputLots: 1n, positionId: '9', priceQ: 50_000_000n, revision: 5, side: 0 as const
    };
    await submitSuccessorPositionEdit({
      edit: { kind: 'reprice-fixed', displayedPrice: '2.4', minimumOutput: '0.5' }, manifest,
      position: { ...common, family: 'Fixed' }, privateTerms: fixedTerms, signer
    });
    const rangeTerms = {
      actionCount: 4, endPriceQ: 40_000_000n, family: 'Range' as const, initialOutputLots: 3n,
      inventory0Lots: 3n, inventory1Lots: 0n, minimumOutputLots: 1n, positionId: '9',
      revision: 6, side: 0 as const, startPriceQ: 50_000_000n
    };
    await submitSuccessorPositionEdit({
      edit: { kind: 'reprice-range', displayedStartPrice: '2', displayedEndPrice: '1.5', minimumOutput: '0.25' }, manifest,
      position: { ...common, family: 'Range' }, privateTerms: rangeTerms, signer
    });

    expect(mocks.contractCall.mock.calls.map(([method]) => method)).toEqual(['repriceFixedLimit', 'repriceRange']);
    expect(mocks.contractCall.mock.calls[0][1].slice(0, 3)).toEqual([9n, 2n, 5n]);
    expect(mocks.contractCall.mock.calls[1][1].slice(0, 3)).toEqual([9n, 2n, 6n]);
    expect(mocks.encrypt.mock.calls.map(([, input]) => input.plaintext)).toEqual([
      120_000_000n, 2n,
      100_000_000n, 37_500_000n, 1n
    ]);
    expect(mocks.ensureTradeTokenAllowance).not.toHaveBeenCalled();
  });

  it('partially exits Fixed and Range with host-bound inputs and no new allowance', async () => {
    const signer = { getAddress: vi.fn(async () => OWNER) } as never;
    const common = { marketKey: MARKET, owner: OWNER, ownershipRevision: 2, positionId: '9' } as const;
    const fixedTerms = {
      actionCount: 4, family: 'Fixed' as const, inventory0Lots: 3n, inventory1Lots: 0n,
      minimumOutputLots: 1n, positionId: '9', priceQ: 50_000_000n, revision: 5, side: 0 as const
    };
    await submitSuccessorPositionEdit({
      edit: { kind: 'partial-exit-fixed', amount: '0.5' }, manifest,
      position: { ...common, family: 'Fixed' }, privateTerms: fixedTerms, signer
    });
    const rangeTerms = {
      actionCount: 4, endPriceQ: 40_000_000n, family: 'Range' as const, initialOutputLots: 3n,
      inventory0Lots: 0n, inventory1Lots: 3n, minimumOutputLots: 1n, positionId: '9',
      revision: 6, side: 1 as const, startPriceQ: 50_000_000n
    };
    await submitSuccessorPositionEdit({
      edit: {
        kind: 'partial-exit-range', amount: '1', displayedStartPrice: '2',
        displayedEndPrice: '2.5', minimumOutput: '1'
      },
      manifest, position: { ...common, family: 'Range' }, privateTerms: rangeTerms, signer
    });

    expect(mocks.contractCall.mock.calls.map(([method]) => method)).toEqual([
      'partialExitFixedLimit', 'partialExitRange'
    ]);
    expect(mocks.contractCall.mock.calls[0][1].slice(0, 3)).toEqual([9n, 2n, 5n]);
    expect(mocks.contractCall.mock.calls[1][1].slice(0, 3)).toEqual([9n, 2n, 6n]);
    expect(mocks.encrypt.mock.calls.map(([, input]) => input.plaintext)).toEqual([
      2n, 1n, 100_000_001n, 62_500_000n, 1n
    ]);
    const host = new Interface([
      'function partialExitFixedLimit(uint256,uint64,(uint256,bytes))',
      'function partialExitRange(uint256,uint64,(uint256,bytes),(uint256,bytes),(uint256,bytes),(uint256,bytes))'
    ]);
    expect(mocks.encrypt.mock.calls[0][1]).toMatchObject({
      contractAddress: FIXED_HOST,
      functionSelector: host.getFunction('partialExitFixedLimit')!.selector
    });
    expect(mocks.encrypt.mock.calls[1][1]).toMatchObject({
      contractAddress: RANGE_HOST,
      functionSelector: host.getFunction('partialExitRange')!.selector
    });
    expect(mocks.ensureTradeTokenAllowance).not.toHaveBeenCalled();
  });

  it('rejects invalid owner, lot amount, and Range direction before allowance or encryption', async () => {
    const terms = {
      actionCount: 4, endPriceQ: 40_000_000n, family: 'Range' as const, initialOutputLots: 3n,
      inventory0Lots: 3n, inventory1Lots: 0n, minimumOutputLots: 1n, positionId: '9',
      revision: 6, side: 0 as const, startPriceQ: 50_000_000n
    };
    const position = { family: 'Range' as const, marketKey: MARKET, owner: OWNER, ownershipRevision: 2, positionId: '9' };
    await expect(submitSuccessorPositionEdit({
      edit: { kind: 'top-up', amount: '0.1' }, manifest, position, privateTerms: terms,
      signer: { getAddress: vi.fn(async () => OWNER) } as never
    })).rejects.toThrow('exact settlement-lot multiple');
    await expect(submitSuccessorPositionEdit({
      edit: { kind: 'reprice-range', displayedStartPrice: '2', displayedEndPrice: '2.5', minimumOutput: '0' },
      manifest, position, privateTerms: terms,
      signer: { getAddress: vi.fn(async () => OWNER) } as never
    })).rejects.toThrow('wrong direction');
    await expect(submitSuccessorPositionEdit({
      edit: { kind: 'top-up', amount: '0.25' }, manifest, position, privateTerms: terms,
      signer: { getAddress: vi.fn(async () => '0x0000000000000000000000000000000000000008') } as never
    })).rejects.toThrow('current Position NFT owner');
    await expect(submitSuccessorPositionEdit({
      edit: {
        kind: 'partial-exit-range', amount: '3', displayedStartPrice: '2',
        displayedEndPrice: '1.5', minimumOutput: '0'
      }, manifest, position, privateTerms: terms,
      signer: { getAddress: vi.fn(async () => OWNER) } as never
    })).rejects.toThrow('below the current offered inventory');
    expect(mocks.ensureTradeTokenAllowance).not.toHaveBeenCalled();
    expect(mocks.encrypt).not.toHaveBeenCalled();
    expect(mocks.getFunction).not.toHaveBeenCalled();
  });

  it('routes Aggregate lifecycle edits through host-bound module selectors and current private revision', async () => {
    const signer = { getAddress: vi.fn(async () => OWNER) } as never;
    const privateTerms = {
      accrued0: 4n, accrued1: 0n, accrued2: 3n, accrued3: 0n,
      actionCount: 8, currentMidpointQ: 50_000_000n, family: 'Aggregate' as const,
      laneMode: 1 as const, maxInventory0Lots: 100n, maxInventory1Lots: 100n,
      minInventory0Lots: 0n, minInventory1Lots: 0n, positionId: '9',
      principal0Lots: 4n, principal1Lots: 6n, revision: 7, spreadFactorPpm: 1_005_000n,
      startingMidpointQ: 50_000_000n, targetLots: 0n, totalMemberShares: 10n,
      virtual0Lots: 8n, virtual1Lots: 8n
    };
    const position = {
      family: 'Aggregate' as const, marketKey: MARKET, owner: OWNER,
      ownershipRevision: 2, positionId: '9'
    };

    await submitSuccessorPositionEdit({
      edit: { kind: 'top-up-aggregate', amount0: '0.5', amount1: '2' },
      manifest, position, privateTerms, signer
    });
    await submitSuccessorPositionEdit({
      edit: { kind: 'reprice-aggregate', displayedMidpoint: '2', totalSpreadPercent: '1' },
      manifest, position, privateTerms, signer
    });
    await submitSuccessorPositionEdit({
      edit: { kind: 'partial-exit-aggregate', shares: '5' },
      manifest, position, privateTerms, signer
    });
    await submitSuccessorPositionEdit({
      edit: { kind: 'withdraw-aggregate-counters', amounts: ['1', '0', '2', '0'] },
      manifest, position, privateTerms, signer
    });

    expect(mocks.contractCall.mock.calls.map(([method]) => method)).toEqual([
      'topUpPosition', 'repricePosition', 'partialExitPosition', 'withdrawCountersPosition'
    ]);
    for (const [, args] of mocks.contractCall.mock.calls) {
      expect(args.slice(0, 3)).toEqual([9n, 2n, 7n]);
    }
    expect(mocks.ensureTradeTokenAllowance.mock.calls).toEqual([
      [signer, OWNER, BCN, 500_000n, 'private-erc20', CORE],
      [signer, OWNER, HBR, 2_000_000n, 'private-erc20', CORE]
    ]);
    const aggregateHost = new Interface([
      'function topUpAggregatePositionModule(uint256,(uint256,bytes),(uint256,bytes))',
      'function repriceAggregatePositionModule(uint256,(uint256,bytes),(uint256,bytes),(uint256,bytes)[7])',
      'function partialExitAggregatePositionModule(uint256,(uint256,bytes))',
      'function withdrawAggregateCountersModule(uint256,(uint256,bytes)[4])'
    ]);
    expect(mocks.encrypt.mock.calls.slice(0, 2).map(([, input]) => input)).toEqual([
      expect.objectContaining({ contractAddress: AGGREGATE_HOST, functionSelector: aggregateHost.getFunction('topUpAggregatePositionModule')!.selector, plaintext: 2n }),
      expect.objectContaining({ contractAddress: AGGREGATE_HOST, functionSelector: aggregateHost.getFunction('topUpAggregatePositionModule')!.selector, plaintext: 2n })
    ]);
    expect(mocks.encrypt.mock.calls.slice(2, 11).every(([, input]) =>
      input.contractAddress === AGGREGATE_HOST && input.functionSelector === aggregateHost.getFunction('repriceAggregatePositionModule')!.selector
    )).toBe(true);
    expect(mocks.encrypt.mock.calls[11][1]).toMatchObject({
      contractAddress: AGGREGATE_HOST,
      functionSelector: aggregateHost.getFunction('partialExitAggregatePositionModule')!.selector,
      plaintext: 5n
    });
    expect(mocks.encrypt.mock.calls.slice(12).every(([, input]) =>
      input.contractAddress === AGGREGATE_HOST && input.functionSelector === aggregateHost.getFunction('withdrawAggregateCountersModule')!.selector
    )).toBe(true);
  });

  it('routes Recurring top-up, reprice, and withdrawal through its host selector', async () => {
    const signer = { getAddress: vi.fn(async () => OWNER) } as never;
    const privateTerms = {
      actionCount: 5, activationOutput0Lots: 4n, activationOutput1Lots: 6n,
      activeIndex: 0 as const, cooldownActions: 0n, cycleCount: 0n, cycleLimit: 0n,
      endPrice0Q: 50_000_000n, endPrice1Q: 60_000_000n, family: 'Recurring' as const,
      inventory0Lots: 4n, inventory1Lots: 6n, lastSwitchRun: 0n,
      minimumOutput0Lots: 1n, minimumOutput1Lots: 1n,
      nextMinimumInventory0Lots: 1n, nextMinimumInventory1Lots: 1n,
      originIndex: 0 as const, paused: false, positionId: '9', recurringClass: 'LL' as const,
      revision: 6, runCount: 2, side0: 0 as const, side1: 1 as const,
      startPrice0Q: 50_000_000n, startPrice1Q: 60_000_000n,
      threshold0Lots: 0n, threshold1Lots: 0n, transitionCount: 0n
    };
    const position = {
      family: 'Recurring' as const, marketKey: MARKET, owner: OWNER,
      ownershipRevision: 2, positionId: '9'
    };

    await submitSuccessorPositionEdit({
      edit: { kind: 'top-up-recurring', amount0: '0.25', amount1: '2' },
      manifest, position, privateTerms, signer
    });
    await submitSuccessorPositionEdit({
      edit: {
        kind: 'reprice-recurring', leg: 0, displayedStartPrice: '2', displayedEndPrice: '2',
        minimumOutput: '0.25', threshold: '0.5', nextMinimum: '1'
      },
      manifest, position, privateTerms, signer
    });
    await submitSuccessorPositionEdit({
      edit: { kind: 'withdraw-recurring', amount0: '0', amount1: '1' },
      manifest, position, privateTerms, signer
    });

    expect(mocks.contractCall.mock.calls.map(([method]) => method)).toEqual([
      'topUpRecurring', 'repriceRecurringLl', 'withdrawRecurring'
    ]);
    for (const [, args] of mocks.contractCall.mock.calls) {
      expect(args.slice(0, 3)).toEqual([9n, 2n, 6n]);
    }
    expect(mocks.ensureTradeTokenAllowance.mock.calls).toEqual([
      [signer, OWNER, BCN, 250_000n, 'private-erc20', CORE],
      [signer, OWNER, HBR, 2_000_000n, 'private-erc20', CORE]
    ]);
    const recurringHost = new Interface([
      'function topUp(uint256,uint64,(uint256,bytes)[2])',
      'function repriceLl(uint256,uint64,(uint256,bytes),(uint256,bytes),(uint256,bytes),(uint256,bytes),(uint256,bytes))',
      'function withdraw(uint256,uint64,(uint256,bytes)[2])'
    ]);
    expect(mocks.encrypt.mock.calls.slice(0, 2).every(([, input]) =>
      input.contractAddress === RECURRING_HOST && input.functionSelector === recurringHost.getFunction('topUp')!.selector
    )).toBe(true);
    expect(mocks.encrypt.mock.calls.slice(2, 7).map(([, input]) => input.plaintext)).toEqual([
      0n, 100_000_000n, 1n, 2n, 1n
    ]);
    expect(mocks.encrypt.mock.calls.slice(2, 7).every(([, input]) =>
      input.contractAddress === RECURRING_HOST && input.functionSelector === recurringHost.getFunction('repriceLl')!.selector
    )).toBe(true);
    expect(mocks.encrypt.mock.calls.slice(7).every(([, input]) =>
      input.contractAddress === RECURRING_HOST && input.functionSelector === recurringHost.getFunction('withdraw')!.selector
    )).toBe(true);
  });

  it('uses the RR reprice selector and preserves the immutable recurring side', async () => {
    const signer = { getAddress: vi.fn(async () => OWNER) } as never;
    const privateTerms = {
      actionCount: 5, activationOutput0Lots: 4n, activationOutput1Lots: 6n,
      activeIndex: 0 as const, cooldownActions: 0n, cycleCount: 0n, cycleLimit: 0n,
      endPrice0Q: 40_000_000n, endPrice1Q: 70_000_000n, family: 'Recurring' as const,
      inventory0Lots: 4n, inventory1Lots: 6n, lastSwitchRun: 0n,
      minimumOutput0Lots: 1n, minimumOutput1Lots: 1n,
      nextMinimumInventory0Lots: 1n, nextMinimumInventory1Lots: 1n,
      originIndex: 0 as const, paused: false, positionId: '9', recurringClass: 'RR' as const,
      revision: 6, runCount: 2, side0: 0 as const, side1: 1 as const,
      startPrice0Q: 50_000_000n, startPrice1Q: 60_000_000n,
      threshold0Lots: 0n, threshold1Lots: 0n, transitionCount: 0n
    };
    await submitSuccessorPositionEdit({
      edit: {
        kind: 'reprice-recurring', leg: 0, displayedStartPrice: '2', displayedEndPrice: '1.5',
        minimumOutput: '0.25', threshold: '0', nextMinimum: '1'
      },
      manifest,
      position: { family: 'Recurring', marketKey: MARKET, owner: OWNER, ownershipRevision: 2, positionId: '9' },
      privateTerms,
      signer
    });

    expect(mocks.contractCall.mock.calls.map(([method]) => method)).toEqual(['repriceRecurringRr']);
    expect(mocks.encrypt.mock.calls.map(([, input]) => input.plaintext)).toEqual([
      0n, 100_000_000n, 37_500_000n, 1n, 0n, 1n
    ]);
  });

  it('transfers only the corrected Position NFT from its current owner', async () => {
    const signer = { getAddress: vi.fn(async () => OWNER) } as never;
    await submitSuccessorPositionTransfer({
      manifest,
      position: { owner: OWNER, positionId: '12' },
      recipient: '0x0000000000000000000000000000000000000008',
      signer
    });

    expect(mocks.getFunction).toHaveBeenCalledWith('safeTransferFrom(address,address,uint256)');
    expect(mocks.contractCall).toHaveBeenCalledWith(
      'safeTransferFrom(address,address,uint256)',
      [OWNER, '0x0000000000000000000000000000000000000008', 12n, { gasLimit: 90_000_000n }]
    );
    await expect(submitSuccessorPositionTransfer({
      manifest,
      position: { owner: OWNER, positionId: '12' },
      recipient: OWNER,
      signer
    })).rejects.toThrow('already owns');
  });
});
