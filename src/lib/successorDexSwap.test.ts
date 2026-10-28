import { describe, expect, it } from 'vitest';
import type { SuccessorDexManifest } from './successorDexDeployment';
import {
  nextSuccessorSwapAction,
  planSuccessorSwap,
  successorSwapAmountProfile,
  type SuccessorSwapProgress
} from './successorDexSwap';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const manifest = {
  tokens: [
    { address: '0x0000000000000000000000000000000000000001', decimals: 6, lotSizeRaw: '10000000', symbol: 'BCN' },
    { address: '0x0000000000000000000000000000000000000002', decimals: 6, lotSizeRaw: '10000000', symbol: 'HBR' }
  ],
  privateBookWorkProfile: {
    inputLatticeCells: 8,
    maximumInputLots: '7',
    semanticId: `0x${'12'.repeat(32)}`
  },
  pairs: [{
    displayPair: 'BCN/HBR',
    marketKey: `0x${'11'.repeat(32)}`,
    sourceCount: 1,
    token0: '0x0000000000000000000000000000000000000001',
    token1: '0x0000000000000000000000000000000000000002'
  }]
} as unknown as SuccessorDexManifest;

describe('planSuccessorSwap', () => {
  it('binds the displayed pair, direction, price, and minimum output', () => {
    const plan = planSuccessorSwap({
      manifest,
      selectedPair: ['BCN', 'HBR'],
      direction: 'quote-to-base',
      amount: '20',
      displayedLimitPrice: 2,
      minimumPercent: 100
    });

    expect(plan.inputSymbol).toBe('HBR');
    expect(plan.outputSymbol).toBe('BCN');
    expect(plan.buyToken0).toBe(true);
    expect(plan.limitPriceQ).toBe(200_000_000n);
    expect(plan.minimumOutputLots).toBe(1n);
    expect(plan.maximumInputLots).toBe(2n);
    expect(plan.maximumInputRaw).toBe(20_000_000n);
  });

  it('accepts decimal token input but rejects a non-lot multiple and sparse direct pairs', () => {
    expect(planSuccessorSwap({
      manifest,
      selectedPair: ['BCN', 'HBR'],
      direction: 'base-to-quote',
      amount: '20',
      displayedLimitPrice: 2,
      minimumPercent: 0
    }).maximumInputLots).toBe(2n);
    expect(() => planSuccessorSwap({
      manifest,
      selectedPair: ['BCN', 'HBR'],
      direction: 'base-to-quote',
      amount: '15',
      displayedLimitPrice: 2,
      minimumPercent: 0
    })).toThrow('exact 10 settlement-lot increments');
    expect(() => planSuccessorSwap({
      manifest: { ...manifest, pairs: [{ ...manifest.pairs[0], sourceCount: 0 }] },
      selectedPair: ['BCN', 'HBR'],
      direction: 'base-to-quote',
      amount: '10',
      displayedLimitPrice: 2,
      minimumPercent: 0
    })).toThrow('sparse-pair P2');
  });

  it('enforces the reviewed manifest work profile before requesting token allowance', () => {
    const maximum = planSuccessorSwap({
      manifest,
      selectedPair: ['BCN', 'HBR'],
      direction: 'base-to-quote',
      amount: '70',
      displayedLimitPrice: 2,
      minimumPercent: 0
    });
    expect(maximum.maximumInputLots).toBe(7n);
    expect(maximum.maximumInputRaw).toBe(70_000_000n);
    expect(successorSwapAmountProfile(manifest, 'BCN')).toEqual({
      lotAmount: '10',
      maximumAmount: '70',
      maximumInputLots: 7n
    });
    expect(() => planSuccessorSwap({
      manifest,
      selectedPair: ['BCN', 'HBR'],
      direction: 'base-to-quote',
      amount: '80',
      displayedLimitPrice: 2,
      minimumPercent: 0
    })).toThrow('at most 70 BCN (7 lots)');
  });
});

describe('nextSuccessorSwapAction', () => {
  const progress = (overrides: Partial<SuccessorSwapProgress> = {}): SuccessorSwapProgress => Object.freeze({
    workCursor: 0,
    settlementCursor: 25,
    cleanupCursor: 0,
    sourceCount: 1,
    recoveryCleanup: false,
    workRevision: 1n,
    workClosed: false,
    remainingEscrow: 1n,
    workCredit: 0n,
    latestBlock: 10n,
    terminalState: null,
    ...overrides
  });

  it('selects evaluation, settlement, recovery, cleanup, and credit withdrawal from public lifecycle state', () => {
    expect(nextSuccessorSwapAction({ progress: progress(), deadline: 20n, currentBlock: 10n })).toBe('advance');
    expect(nextSuccessorSwapAction({ progress: progress({ workCursor: 25 }), deadline: 20n, currentBlock: 19n })).toBe('settle');
    expect(nextSuccessorSwapAction({ progress: progress({ workCursor: 25 }), deadline: 20n, currentBlock: 20n })).toBe('recover');
    expect(nextSuccessorSwapAction({ progress: progress({ recoveryCleanup: true }), deadline: 20n, currentBlock: 20n })).toBe('cleanup');
    expect(nextSuccessorSwapAction({ progress: progress({ workCursor: 26 }), deadline: 20n, currentBlock: 21n })).toBe('cleanup');
    expect(nextSuccessorSwapAction({ progress: progress({ workClosed: true, workCredit: 1n }), deadline: 20n, currentBlock: 21n })).toBe('withdraw-credit');
    expect(nextSuccessorSwapAction({ progress: progress({ workClosed: true }), deadline: 20n, currentBlock: 21n })).toBe('complete');
  });
});

describe('successor Swap nonce domains', () => {
  it('uses the private-book nonce for submission and the Core direct nonce for credit withdrawal', () => {
    const source = readFileSync(fileURLToPath(new URL('./successorDexSwap.ts', import.meta.url)), 'utf8');
    expect(source).toContain('function privateBookOwnerNonce(address owner)');
    expect(source).toContain("manifest.contracts['work-authority']?.address");
    expect(source).toContain('function directOwnerNonces(address owner)');
    expect(source).toContain("core.getFunction('directOwnerNonces').staticCall(owner)");
    expect(source).toContain("authority.getFunction('privateBookWorkConfig').staticCall");
    expect(source).toContain("authority.getFunction('reencryptMyPrivateBookReceipt').staticCall");
    expect(source).not.toMatch(/\b(?:authority|core)\.[A-Za-z0-9_]+\.staticCall/u);
    expect(source).not.toContain('LOT_SIZE_RAW');
    expect(source).not.toContain('SUCCESSOR_SWAP_MAXIMUM_INPUT_LOTS');
    expect(source).toContain('plan.maximumInputRaw');
    expect(source.indexOf('const nonce = await ownerNonce')).toBeLessThan(source.indexOf('await ensureTradeTokenAllowance'));
  });
});
