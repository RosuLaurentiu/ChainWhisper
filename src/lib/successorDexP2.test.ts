import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { SuccessorDexManifest } from './successorDexDeployment';
import {
  nextSuccessorP2Action,
  planSuccessorP2FallbackFromDirect,
  planSuccessorP2Intent,
  reduceSuccessorP2Events,
  successorP2PairMatches,
  type SuccessorP2Status
} from './successorDexP2';
import { planSuccessorSwap } from './successorDexSwap';

const manifest = {
  contracts: {
    'work-authority': { address: '0x0000000000000000000000000000000000000010' },
    'p2-route-registry': { address: '0x0000000000000000000000000000000000000011' }
  },
  globalCore: '0x0000000000000000000000000000000000000012',
  deploymentBlockRange: [1, 2],
  tokens: [
    { address: '0x0000000000000000000000000000000000000001', decimals: 6, lotSizeRaw: '250000', symbol: 'BCN' },
    { address: '0x0000000000000000000000000000000000000002', decimals: 6, lotSizeRaw: '500000', symbol: 'HBR' }
  ],
  privateBookWorkProfile: { maximumInputLots: '7' },
  pairs: [{
    displayPair: 'BCN/HBR',
    marketKey: `0x${'11'.repeat(32)}`,
    seedProfile: 'p2-sparse',
    sourceCount: 0,
    token0: '0x0000000000000000000000000000000000000001',
    token1: '0x0000000000000000000000000000000000000002'
  }]
} as unknown as SuccessorDexManifest;

const status = (overrides: Partial<SuccessorP2Status> = {}): SuccessorP2Status => Object.freeze({
  intentId: 1n,
  owner: '0x0000000000000000000000000000000000000001',
  recipient: '0x0000000000000000000000000000000000000001',
  tokenIn: '0x0000000000000000000000000000000000000001',
  tokenOut: '0x0000000000000000000000000000000000000002',
  expiry: 100n,
  routeRegistryRevision: 2n,
  fundingRevision: 1n,
  intentRevision: 1n,
  intentStatus: 1,
  attemptCount: 0n,
  workRevision: 0n,
  workStage: 0,
  workRecovered: false,
  workCredit: 0n,
  latestTimestamp: 50n,
  ...overrides
});

describe('corrected successor P2 planning', () => {
  it('normalizes token lots and derives net rate protection for a sparse pair', () => {
    const plan = planSuccessorP2Intent({
      manifest,
      selectedPair: ['BCN', 'HBR'],
      direction: 'base-to-quote',
      amount: '1.5',
      displayedLimitPrice: 2,
      minimumPercent: 50
    });
    expect(plan.eligibility).toBe('sparse');
    expect(plan.maximumInputLots).toBe(6n);
    expect(plan.maximumInputRaw).toBe(1_500_000n);
    expect(plan.minimumRatePpm).toBe(1_000_000n);
    expect(plan.minimumOutputLots).toBe(3n);
  });

  it('requires an authenticated direct receipt and ignores exhausted seed metadata', () => {
    const directManifest = {
      ...manifest,
      pairs: [{ ...manifest.pairs[0], sourceCount: 1, seedProfile: 'p2-exhausted' }]
    } as SuccessorDexManifest;
    expect(() => planSuccessorP2Intent({
      manifest: directManifest,
      selectedPair: ['BCN', 'HBR'],
      direction: 'quote-to-base',
      amount: '1',
      displayedLimitPrice: 2,
      minimumPercent: 0
    })).toThrow('authenticated exhausted-direct receipt');
    const directPlan = planSuccessorSwap({
      manifest: directManifest,
      selectedPair: ['BCN', 'HBR'],
      direction: 'quote-to-base',
      amount: '1',
      displayedLimitPrice: 2,
      minimumPercent: 0
    });
    expect(() => planSuccessorP2FallbackFromDirect({ directPlan, directUnavailable: false }))
      .toThrow('authenticated exhausted-direct owner receipt');
    expect(planSuccessorP2FallbackFromDirect({ directPlan, directUnavailable: true })).toMatchObject({
      eligibility: 'direct-no-match',
      maximumInputLots: directPlan.maximumInputLots,
      maximumInputRaw: directPlan.maximumInputRaw,
      minimumOutputLots: directPlan.minimumOutputLots
    });
  });

  it('rejects a sparse amount outside the public work domain', () => {
    expect(() => planSuccessorP2Intent({
      manifest,
      selectedPair: ['BCN', 'HBR'],
      direction: 'base-to-quote',
      amount: '2',
      displayedLimitPrice: 2,
      minimumPercent: 0
    })).toThrow('at most 1.75 BCN');
  });
});

describe('corrected successor P2 public lifecycle', () => {
  it('reduces intent and work events without reading private storage', () => {
    expect(reduceSuccessorP2Events([
      { name: 'submitted' },
      { name: 'work-opened', revision: 1n },
      { name: 'work-frame', revision: 2n, stage: 2 },
      { name: 'processed', status: 2, attemptCount: 1n },
      { name: 'work-frame', revision: 3n, stage: 5 },
      { name: 'work-frame', revision: 4n, stage: 7 }
    ])).toEqual({
      intentRevision: 2n,
      intentStatus: 2,
      attemptCount: 1n,
      workRevision: 4n,
      workStage: 7,
      workRecovered: false
    });
    expect(reduceSuccessorP2Events([
      { name: 'work-opened', revision: 1n },
      { name: 'work-recovered' },
      { name: 'recovered', status: 3 }
    ])).toMatchObject({
      intentStatus: 3,
      workRevision: 2n,
      workStage: 6,
      workRecovered: true
    });
  });

  it('keeps only permissionless frames in the background action set', () => {
    expect(nextSuccessorP2Action(status())).toBe('reopen');
    expect(nextSuccessorP2Action(status({ workStage: 6, workRevision: 12n }))).toBe('fold');
    expect(nextSuccessorP2Action(status({ workStage: 7, workRevision: 13n }))).toBe('reopen');
    expect(nextSuccessorP2Action(status({ workStage: 1, workRevision: 1n }))).toBe('advance');
    expect(nextSuccessorP2Action(status({ workStage: 4, workRevision: 9n }))).toBe('settle');
    expect(nextSuccessorP2Action(status({ workStage: 5, workRevision: 10n, intentStatus: 2, intentRevision: 2n }))).toBe('fold');
    expect(nextSuccessorP2Action(status({ workStage: 3, latestTimestamp: 100n }))).toBe('recover-work');
    expect(nextSuccessorP2Action(status({ workStage: 2, intentStatus: 4, intentRevision: 2n }))).toBe('recover-work');
    expect(nextSuccessorP2Action(status({ latestTimestamp: 100n }))).toBe('recover-intent');
    expect(nextSuccessorP2Action(status({ workStage: 6, workRevision: 12n, latestTimestamp: 100n }))).toBe('fold');
    expect(nextSuccessorP2Action(status({ workStage: 7, workRevision: 13n, latestTimestamp: 100n }))).toBe('recover-intent');
    expect(nextSuccessorP2Action(status({ workStage: 7, workRevision: 13n, intentStatus: 3, intentRevision: 2n }))).toBe('complete');
    expect(nextSuccessorP2Action(status({ intentStatus: 4, intentRevision: 2n }))).toBe('complete');
  });

  it('lets a later canonical open event resume a completed no-match lifecycle', () => {
    expect(reduceSuccessorP2Events([
      { name: 'submitted' },
      { name: 'work-opened', revision: 1n },
      { name: 'processed', status: 1, attemptCount: 1n },
      { name: 'work-frame', revision: 7n, stage: 7 },
      { name: 'work-opened', revision: 1n }
    ])).toMatchObject({
      intentStatus: 1,
      attemptCount: 1n,
      workRevision: 1n,
      workStage: 1,
      workRecovered: false
    });
  });

  it('matches reload candidates by the unordered canonical pair only', () => {
    const pair = manifest.pairs[0];
    expect(successorP2PairMatches(pair, pair.token0, pair.token1)).toBe(true);
    expect(successorP2PairMatches(pair, pair.token1, pair.token0)).toBe(true);
    expect(successorP2PairMatches(pair, pair.token0, '0x0000000000000000000000000000000000000003')).toBe(false);
    expect(successorP2PairMatches(pair, pair.token0, pair.token0)).toBe(false);
  });
});

describe('corrected successor P2 ABI discipline', () => {
  it('quotes exact work escrow and submits plus opens atomically under one encryption domain', () => {
    const source = readFileSync(fileURLToPath(new URL('./successorDexP2.ts', import.meta.url)), 'utf8');
    expect(source).toContain('function submitAndOpenPrivateIntentP2');
    expect(source).toContain('function quoteCompleteBookP2Work');
    expect(source).toContain("getFunction('quoteCompleteBookP2Work')");
    expect(source).toContain('.staticCall(plan.inputToken, plan.outputToken, expectedRouteRegistryRevision)');
    expect(source).toContain("getFunction('submitAndOpenPrivateIntentP2')!.selector");
    expect(source).toContain('await authority.submitAndOpenPrivateIntentP2(');
    expect(source).toContain('{ value: requiredWorkEscrowWei, gasLimit: GAS_LIMIT }');
    expect(source).toContain("parsedCall.name !== 'submitAndOpenPrivateIntentP2'");
    expect(source).toContain("if (plan.eligibility === 'sparse')");
    expect(source).toMatch(/if \(plan\.eligibility === 'sparse'\) \{\s+await ensureTradeTokenAllowance/u);
  });

  it('keeps the corrected stage, recovery, credit, and static-call surface only', () => {
    const source = readFileSync(fileURLToPath(new URL('./successorDexP2.ts', import.meta.url)), 'utf8');
    expect(source).toContain('advanceCompleteBookP2Work');
    expect(source).toContain('settleCompleteBookP2Work');
    expect(source).toContain('foldCompleteBookP2Work');
    expect(source).toContain('reopenCompleteBookP2Work');
    expect(source).toContain('recoverExpiredCompleteBookP2Work');
    expect(source).toContain('cancelPrivateIntentP2');
    expect(source).toContain('recoverExpiredPrivateIntentP2');
    expect(source).toContain('withdrawPrivateIntentP2Credit');
    expect(source).toContain('withdrawPrivateBookWorkCredit');
    expect(source).toContain("manifest.contracts['p2-route-registry']");
    expect(source).toContain("getFunction('registryRevision').staticCall()");
    expect(source).toContain("getFunction('privateBookWorkCredit').staticCall(owner)");
    expect(source).toContain("getFunction('directCreditRevision').staticCall(owner, tokenAddress)");
    expect(source).not.toMatch(/\b(?:authority|core|routeRegistry)\.[A-Za-z0-9_]+\.staticCall/u);
    expect(source).not.toContain('PrivateIntentP2CoreV0');
    expect(source).not.toContain('submitSolverProposal');
    expect(source).not.toContain('function submitPrivateIntentP2(');
    expect(source).not.toContain('owner-open-required');
    expect(source).not.toContain('function openCompleteBookP2Work(');

    const discovery = source.slice(
      source.indexOf('export const findResumableSuccessorP2'),
      source.indexOf('export const reopenSuccessorP2Work')
    );
    expect(discovery).toContain("EVENTS.getEvent('PrivateIntentP2Submitted')");
    expect(discovery).toContain('EVENTS.parseTransaction');
    expect(discovery).toContain("call.name !== 'submitAndOpenPrivateIntentP2'");
    expect(discovery).toContain('successorP2PairMatches(pair, tokenIn, tokenOut)');

    const recovery = source.slice(
      source.indexOf('export const recoverExpiredSuccessorP2'),
      source.indexOf('export const revealSuccessorP2Receipt')
    );
    expect(recovery).toContain('nextSuccessorP2Action(status)');
    expect(recovery).not.toContain('signer.getAddress');
    expect(recovery).not.toContain('status.owner');
  });
});
