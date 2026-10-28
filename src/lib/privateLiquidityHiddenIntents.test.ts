import { describe, expect, it, vi } from 'vitest';
import {
  buildPrivateLiquidityPairKey,
  type PrivateLiquidityPosition,
  type PrivateLiquiditySideTerms
} from './privateLiquidity';
import type { CompleteCanonicalPrivateLiquidityPositionSnapshot } from './privateLiquidityChain';
import {
  PRIVATE_LIQUIDITY_HIDDEN_V2_MAX_TTL_SECONDS,
  assertPreparedPrivateLiquidityHiddenIntent,
  assertPreparedPrivateLiquidityHiddenIntentSettlementRoutes,
  buildPrivateLiquidityHiddenIntentSettlementRoutes,
  decodePrivateLiquidityHiddenIntentBudget,
  decodePrivateLiquidityHiddenIntentTerms,
  materializePrivateLiquidityHiddenIntentOwnerReceipt,
  materializePrivateLiquidityHiddenIntentPublicView,
  preparePrivateLiquidityHiddenIntent
} from './privateLiquidityHiddenIntents';
import { packSelfCheckingPrivateLiquidityAmountForTest } from './privateLiquidityReceipt';

vi.mock('./privateLiquidityChain', async (importOriginal) => ({
  ...await importOriginal<typeof import('./privateLiquidityChain')>(),
  assertCompleteCanonicalPrivateLiquidityPositionSnapshot: vi.fn()
}));

const address = (byte: string): string => `0x${byte.repeat(40)}`;
const BASE = address('1');
const QUOTE = address('2');
const OTHER = address('3');
const CONTRACT = address('4');
const OWNER = address('5');
const PAIR = buildPrivateLiquidityPairKey(BASE, QUOTE);

const terms = (baseAmount: bigint, quoteAmount: bigint): PrivateLiquiditySideTerms =>
  Object.freeze({ baseAmount: baseAmount.toString(), quoteAmount: quoteAmount.toString() });

const position = ({
  id,
  buy = terms(1n, 9n),
  sell = terms(1n, 10n),
  status = 'active',
  baseToken = BASE,
  quoteToken = QUOTE,
  owner = OWNER,
  privacyOwner = owner,
  buySideAvailable = true,
  sellSideAvailable = true
}: {
  id: number;
  buy?: PrivateLiquiditySideTerms;
  sell?: PrivateLiquiditySideTerms;
  status?: PrivateLiquidityPosition['status'];
  baseToken?: string;
  quoteToken?: string;
  owner?: string;
  privacyOwner?: string | null;
  buySideAvailable?: boolean;
  sellSideAvailable?: boolean;
}): PrivateLiquidityPosition => Object.freeze({
  identity: Object.freeze({ chainId: '2632500', contractAddress: CONTRACT, positionId: String(id) }),
  owner,
  pairKey: buildPrivateLiquidityPairKey(baseToken, quoteToken),
  baseToken,
  quoteToken,
  buyTerms: buy,
  sellTerms: sell,
  status,
  revision: String(id + 10),
  buySideAvailable,
  sellSideAvailable,
  privacyOwner,
  createdAt: '100',
  lastActivityBlock: '200'
});

const snapshot = (positions: readonly PrivateLiquidityPosition[]) => Object.freeze({
  scope: Object.freeze({ chainId: '2632500', contractAddress: CONTRACT, deploymentBlock: '10' }),
  atBlock: Object.freeze({ number: '200', hash: `0x${'a'.repeat(64)}` }),
  positionCount: String(positions.length),
  positions: Object.freeze(positions)
}) as unknown as CompleteCanonicalPrivateLiquidityPositionSnapshot;

describe('privateLiquidityHiddenIntents', () => {
  it('packs exactly two uint256 values and round-trips both private sides', () => {
    const sell = preparePrivateLiquidityHiddenIntent({
      baseToken: BASE,
      quoteToken: QUOTE,
      side: 'sell-base',
      limitTerms: terms(3n, 29n),
      maximumBudget: 500n,
      minimumFill: 125n,
      cooldownBlocks: 20,
      expiresAt: 2_000,
      currentTimestamp: 1_000
    });
    assertPreparedPrivateLiquidityHiddenIntent(sell);
    expect(decodePrivateLiquidityHiddenIntentTerms(sell.privateTermsPlaintext)).toEqual({
      side: 'sell-base',
      limitTerms: { baseAmount: '3', quoteAmount: '29' }
    });
    expect(decodePrivateLiquidityHiddenIntentBudget(sell.privateBudgetPlaintext)).toEqual({
      remainingBudget: '500',
      minimumFill: '125'
    });

    const buy = preparePrivateLiquidityHiddenIntent({
      baseToken: BASE,
      quoteToken: QUOTE,
      side: 'buy-base',
      limitTerms: terms(7n, 71n),
      maximumBudget: 900n,
      minimumFill: 0n,
      cooldownBlocks: 0,
      expiresAt: 0,
      currentTimestamp: 1_000
    });
    expect(decodePrivateLiquidityHiddenIntentTerms(buy.privateTermsPlaintext).side).toBe('buy-base');
    expect(BigInt(buy.privateTermsPlaintext) >> 254n).toBe(1n);
    expect(BigInt(buy.privateBudgetPlaintext)).toBe((900n << 128n));
  });

  it('rejects forged drafts and every invalid packed-input boundary', () => {
    expect(() => assertPreparedPrivateLiquidityHiddenIntent({} as never)).toThrow('exact locally prepared');
    const common = {
      baseToken: BASE,
      quoteToken: QUOTE,
      side: 'sell-base' as const,
      limitTerms: terms(1n, 10n),
      maximumBudget: 100n,
      minimumFill: 10n,
      cooldownBlocks: 0,
      expiresAt: 0,
      currentTimestamp: 1_000
    };
    expect(() => preparePrivateLiquidityHiddenIntent({ ...common, maximumBudget: 0n })).toThrow('positive');
    expect(() => preparePrivateLiquidityHiddenIntent({ ...common, minimumFill: 101n })).toThrow('at least');
    expect(() => preparePrivateLiquidityHiddenIntent({
      ...common,
      limitTerms: terms(1n << 127n, 1n)
    })).toThrow('uint127');
    expect(() => preparePrivateLiquidityHiddenIntent({
      ...common,
      expiresAt: 1_000 + PRIVATE_LIQUIDITY_HIDDEN_V2_MAX_TTL_SECONDS + 1
    })).toThrow('30 days');
    expect(() => decodePrivateLiquidityHiddenIntentTerms(1n << 255n)).toThrow('reserved high bit');
  });

  it('builds complete ask and bid routes from every active position, independent of availability', () => {
    const positions = [
      position({ id: 1, buy: terms(1n, 9n), sell: terms(1n, 10n), sellSideAvailable: false }),
      position({ id: 2, buy: terms(1n, 11n), sell: terms(1n, 8n), buySideAvailable: false }),
      position({ id: 3, buy: terms(1n, 9n), sell: terms(1n, 10n) }),
      position({ id: 4, status: 'paused' }),
      position({ id: 5, baseToken: QUOTE, quoteToken: OTHER })
    ];
    const result = buildPrivateLiquidityHiddenIntentSettlementRoutes({
      snapshot: snapshot(positions),
      baseToken: BASE,
      quoteToken: QUOTE
    });
    expect(result.completeActiveSet).toBe(true);
    expect(result.activePositionCount).toBe(3);
    expect(result.asks.positionIds).toEqual(['2', '1', '3']);
    expect(result.asks.expectedRevisions).toEqual(['12', '11', '13']);
    expect(result.bids.positionIds).toEqual(['2', '1', '3']);
    expect(new Set(result.asks.positionIds)).toEqual(new Set(result.bids.positionIds));
    expect(() => assertPreparedPrivateLiquidityHiddenIntentSettlementRoutes({ ...result } as never))
      .toThrow('exact routes derived from a complete canonical snapshot');
    expect(() => assertPreparedPrivateLiquidityHiddenIntentSettlementRoutes(result)).not.toThrow();
  });

  it('fails closed on missing privacy authority, empty pairs, and more than eight active positions', () => {
    expect(() => buildPrivateLiquidityHiddenIntentSettlementRoutes({
      snapshot: snapshot([position({ id: 1, privacyOwner: null })]),
      baseToken: BASE,
      quoteToken: QUOTE
    })).toThrow('privacy authority');
    expect(() => buildPrivateLiquidityHiddenIntentSettlementRoutes({
      snapshot: snapshot([position({ id: 1, status: 'paused' })]),
      baseToken: BASE,
      quoteToken: QUOTE
    })).toThrow('between one and eight');
    expect(() => buildPrivateLiquidityHiddenIntentSettlementRoutes({
      snapshot: snapshot(Array.from({ length: 9 }, (_, index) => position({ id: index + 1 }))),
      baseToken: BASE,
      quoteToken: QUOTE
    })).toThrow('between one and eight');
  });

  it('materializes recipient-only private receipts and preserves self-checks', () => {
    const prepared = preparePrivateLiquidityHiddenIntent({
      baseToken: BASE,
      quoteToken: QUOTE,
      side: 'buy-base',
      limitTerms: terms(2n, 21n),
      maximumBudget: 800n,
      minimumFill: 200n,
      cooldownBlocks: 2,
      expiresAt: 0,
      currentTimestamp: 1_000
    });
    const receipt = materializePrivateLiquidityHiddenIntentOwnerReceipt({
      intentId: 7,
      recipient: OWNER,
      sequence: 3,
      packedTerms: prepared.privateTermsPlaintext,
      packedBudget: (550n << 128n) + 200n,
      lastInputAmount: packSelfCheckingPrivateLiquidityAmountForTest(250n),
      lastOutputAmount: packSelfCheckingPrivateLiquidityAmountForTest(24n)
    });
    expect(receipt).toEqual({
      intentId: '7',
      recipient: OWNER,
      sequence: '3',
      side: 'buy-base',
      limitTerms: { baseAmount: '2', quoteAmount: '21' },
      remainingBudget: '550',
      minimumFill: '200',
      lastInputAmount: '250',
      lastOutputAmount: '24'
    });
    expect(() => materializePrivateLiquidityHiddenIntentOwnerReceipt({
      intentId: 7,
      recipient: OWNER,
      sequence: 3,
      packedTerms: prepared.privateTermsPlaintext,
      packedBudget: prepared.privateBudgetPlaintext,
      lastInputAmount: 1,
      lastOutputAmount: packSelfCheckingPrivateLiquidityAmountForTest(0n)
    })).toThrow('failed its self-check');
  });

  it('keeps private direction, limits, budgets, and fills out of the public view', () => {
    const view = materializePrivateLiquidityHiddenIntentPublicView({
      intentId: 9,
      status: 1,
      owner: OWNER,
      baseToken: BASE,
      quoteToken: QUOTE,
      pairKey: PAIR,
      createdAt: 1_000,
      expiresAt: 2_000,
      cooldownBlocks: 12,
      fillCount: 0,
      lastActivityBlock: 300,
      lastFillBlock: 0,
      hasPrivateTerms: true
    });
    expect(view.status).toBe('open');
    const serialized = JSON.stringify(view);
    expect(serialized).not.toMatch(/side|limit|budget|minimumFill|inputAmount|outputAmount/);
    expect(() => materializePrivateLiquidityHiddenIntentPublicView({
      ...view,
      status: 0,
      pairKey: PAIR
    })).toThrow('uninitialized');
  });
});
