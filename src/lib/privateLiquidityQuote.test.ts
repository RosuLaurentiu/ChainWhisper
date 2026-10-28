import { describe, expect, it } from 'vitest';
import {
  buildPrivateLiquidityPairKey,
  buildPrivateLiquidityPositionKey,
  type PrivateLiquidityPosition,
  type PrivateLiquiditySideTerms
} from './privateLiquidity';
import {
  preparePrivateLiquidityCandidates,
  preparePrivateLiquiditySwapQuote
} from './privateLiquidityQuote';

const CONTRACT = '0x0000000000000000000000000000000000000100';
const BASE = '0x0000000000000000000000000000000000000010';
const QUOTE = '0x0000000000000000000000000000000000000020';
const OTHER_TOKEN = '0x0000000000000000000000000000000000000030';
const OWNER = '0x0000000000000000000000000000000000000040';

const terms = (baseAmount: bigint, quoteAmount: bigint): PrivateLiquiditySideTerms => ({
  baseAmount: baseAmount.toString(),
  quoteAmount: quoteAmount.toString()
});

const position = ({
  id,
  bid = terms(1n, 9n),
  ask = terms(1n, 11n),
  status = 'active',
  buySideAvailable = true,
  sellSideAvailable = true,
  privacyOwner = OWNER,
  chainId = '2632500',
  contractAddress = CONTRACT,
  baseToken = BASE,
  quoteToken = QUOTE
}: {
  id: number;
  bid?: PrivateLiquiditySideTerms;
  ask?: PrivateLiquiditySideTerms;
  status?: PrivateLiquidityPosition['status'];
  buySideAvailable?: boolean;
  sellSideAvailable?: boolean;
  privacyOwner?: string | null;
  chainId?: string;
  contractAddress?: string;
  baseToken?: string;
  quoteToken?: string;
}): PrivateLiquidityPosition => ({
  identity: {
    chainId,
    contractAddress,
    positionId: id.toString()
  },
  owner: OWNER,
  pairKey: buildPrivateLiquidityPairKey(baseToken, quoteToken),
  baseToken,
  quoteToken,
  buyTerms: bid,
  sellTerms: ask,
  status,
  revision: '4',
  buySideAvailable,
  sellSideAvailable,
  privacyOwner,
  createdAt: '100',
  lastActivityBlock: '200'
});

const prepare = (
  positions: readonly PrivateLiquidityPosition[],
  direction: 'base-to-quote' | 'quote-to-base' = 'base-to-quote',
  maxCandidates?: number
) =>
  preparePrivateLiquidityCandidates({
    chainId: '2632500',
    contractAddress: CONTRACT,
    baseToken: BASE,
    quoteToken: QUOTE,
    direction,
    positions,
    maxCandidates
  });

describe('privateLiquidityQuote', () => {
  it('builds canonical deployment-qualified position identities', () => {
    expect(
      buildPrivateLiquidityPositionKey({
        chainId: '2632500',
        contractAddress: CONTRACT,
        positionId: '7'
      })
    ).toBe(`private-liquidity-v1:2632500:${CONTRACT}:7`);
    expect(() =>
      buildPrivateLiquidityPositionKey({
        chainId: '02632500',
        contractAddress: CONTRACT,
        positionId: '7'
      })
    ).toThrow(/canonical unsigned decimal/);
    expect(() => buildPrivateLiquidityPairKey(QUOTE, BASE)).toThrow(/canonical ascending/);
  });

  it('orders base-to-quote swaps by highest bid and then lowest position ID', () => {
    const result = prepare([
      position({ id: 8, bid: terms(1n, 10n) }),
      position({ id: 3, bid: terms(2n, 20n) }),
      position({ id: 1, bid: terms(1n, 9n) })
    ]);
    expect(result.candidates.map((candidate) => candidate.positionId)).toEqual(['3', '8', '1']);
    expect(result.bestMarginalTerms).toEqual(terms(2n, 20n));
    expect(result.candidateSetComplete).toBe(true);
    expect(result.canClaimGlobalBestExecution).toBe(false);
  });

  it('orders quote-to-base swaps by lowest ask and then lowest position ID', () => {
    const result = prepare(
      [
        position({ id: 9, ask: terms(2n, 20n) }),
        position({ id: 2, ask: terms(1n, 10n) }),
        position({ id: 1, ask: terms(1n, 11n) })
      ],
      'quote-to-base'
    );
    expect(result.candidates.map((candidate) => candidate.positionId)).toEqual(['2', '9', '1']);
  });

  it('uses all eligible positions up to the contract cap and reports every omission', () => {
    const positions = Array.from({ length: 11 }, (_, index) =>
      position({ id: index + 1, bid: terms(1n, BigInt(100 - index)) })
    );
    const result = prepare(positions);
    expect(result.candidates).toHaveLength(8);
    expect(result.eligiblePositionCount).toBe(11);
    expect(result.omittedPositionCount).toBe(3);
    expect(result.candidateSetComplete).toBe(false);
    expect(result.candidates.map((candidate) => candidate.positionId)).toEqual([
      '1',
      '2',
      '3',
      '4',
      '5',
      '6',
      '7',
      '8'
    ]);
  });

  it('filters inactive, unavailable, unactivated, and out-of-scope positions', () => {
    const result = prepare([
      position({ id: 1 }),
      position({ id: 2, status: 'paused' }),
      position({ id: 3, buySideAvailable: false }),
      position({ id: 4, privacyOwner: null }),
      position({ id: 5, chainId: '7082400' }),
      position({ id: 6, contractAddress: '0x0000000000000000000000000000000000000101' }),
      position({ id: 7, baseToken: QUOTE, quoteToken: OTHER_TOKEN })
    ]);
    expect(result.candidates.map((candidate) => candidate.positionId)).toEqual(['1']);
    expect(result.eligiblePositionCount).toBe(1);
  });

  it('rejects duplicate identities, invalid privacy ownership, and unsafe limits', () => {
    const duplicate = position({ id: 1 });
    expect(() => prepare([duplicate, duplicate])).toThrow(/Duplicate private-liquidity position/);
    expect(() =>
      prepare([
        {
          ...position({ id: 2 }),
          privacyOwner: '0x0000000000000000000000000000000000000099'
        }
      ])
    ).toThrow(/privacy owner must match/);
    expect(() => prepare([position({ id: 3 })], 'base-to-quote', 9)).toThrow(/between 1 and 8/);
    expect(() => prepare([position({ id: 4 })], 'base-to-quote', 0)).toThrow(/between 1 and 8/);
  });

  it('returns only public terms and revisions without inventing capacity or amounts', () => {
    const result = prepare([position({ id: 5, bid: terms(5n, 47n) })]);
    expect(result.candidates[0]).toEqual({
      key: `private-liquidity-v1:2632500:${CONTRACT}:5`,
      positionId: '5',
      expectedRevision: '4',
      terms: terms(5n, 47n),
      owner: OWNER
    });
    expect(JSON.stringify(result)).not.toMatch(/inventory|capacity|inputAmount|outputAmount/);
  });

  it('filters public prices to the user limit and packs maximum input with encrypted minimum fill', () => {
    const plan = prepare([
      position({ id: 1, bid: terms(1n, 10n) }),
      position({ id: 2, bid: terms(1n, 9n) })
    ]);
    const quote = preparePrivateLiquiditySwapQuote({
      plan,
      inputAmount: 100n,
      slippageBps: 1_000,
      minimumFillBps: 5_000
    });
    expect(quote).toMatchObject({
      direction: 'base-to-quote',
      maximumInput: '100',
      minimumInputFilled: '50',
      bestFullFillOutput: '1000',
      // floor(100 * 9) minus one possible cross-position rounding unit.
      limitFullFillOutput: '899',
      selectedCandidateCount: 2,
      exactCapacityKnown: false,
      executionPolicy: 'partial-fill-to-price-limit',
      unusedInputStaysInWallet: true
    });
    expect(BigInt(quote.packedSwapValue)).toBe((100n << 128n) + 50n);
  });

  it('calculates quote-to-base full-fill bounds inside the selected public price limit', () => {
    const plan = prepare(
      [
        position({ id: 1, ask: terms(10n, 100n) }),
        position({ id: 2, ask: terms(9n, 100n) })
      ],
      'quote-to-base'
    );
    const quote = preparePrivateLiquiditySwapQuote({
      plan,
      inputAmount: '1000',
      slippageBps: 1_200,
      minimumFillBps: 2_500
    });
    expect(plan.candidates.map(({ positionId }) => positionId)).toEqual(['1', '2']);
    expect(quote.bestFullFillOutput).toBe('100');
    expect(quote.limitFullFillOutput).toBe('89');
    expect(quote.minimumInputFilled).toBe('250');
  });

  it('excludes positions beyond the price limit and rounds the private minimum fill upward', () => {
    const plan = prepare([
      position({ id: 1, bid: terms(1n, 100n) }),
      position({ id: 2, bid: terms(1n, 96n) }),
      position({ id: 3, bid: terms(1n, 94n) })
    ]);
    const quote = preparePrivateLiquiditySwapQuote({
      plan,
      inputAmount: '101',
      slippageBps: 500,
      minimumFillBps: 2_500
    });
    expect(quote.candidates.map(({ positionId }) => positionId)).toEqual(['1', '2']);
    expect(quote.limitTerms).toEqual(terms(1n, 96n));
    expect(quote.minimumInputFilled).toBe('26');
    expect(BigInt(quote.packedSwapValue)).toBe((101n << 128n) + 26n);
  });

  it('uses a one-unit conditional full-fill floor for tiny private outputs', () => {
    const plan = prepare([
      position({ id: 1, bid: terms(100n, 1n) }),
      position({ id: 2, bid: terms(100n, 1n) })
    ]);
    const quote = preparePrivateLiquiditySwapQuote({
      plan,
      inputAmount: '100',
      slippageBps: 9_999,
      minimumFillBps: 0
    });
    expect(quote.bestFullFillOutput).toBe('1');
    expect(quote.limitFullFillOutput).toBe('1');
    expect(quote.minimumInputFilled).toBe('0');
  });

  it('rejects missing candidates, unusable amounts, and invalid slippage', () => {
    const empty = prepare([]);
    expect(() => preparePrivateLiquiditySwapQuote({
      plan: empty,
      inputAmount: '1',
      slippageBps: 50,
      minimumFillBps: 0
    })).toThrow(/at least one selected candidate/);
    const plan = prepare([position({ id: 1 })]);
    expect(() => preparePrivateLiquiditySwapQuote({ plan, inputAmount: '0', slippageBps: 50, minimumFillBps: 0 }))
      .toThrow(/between 1 and uint128 max/);
    expect(() => preparePrivateLiquiditySwapQuote({
      plan,
      inputAmount: (1n << 128n).toString(),
      slippageBps: 50,
      minimumFillBps: 0
    })).toThrow(/between 1 and uint128 max/);
    expect(() => preparePrivateLiquiditySwapQuote({
      plan,
      inputAmount: '1',
      slippageBps: 10_000,
      minimumFillBps: 0
    }))
      .toThrow(/between 0 and 9,999/);
    expect(() => preparePrivateLiquiditySwapQuote({
      plan,
      inputAmount: '1',
      slippageBps: 50,
      minimumFillBps: 10_001
    })).toThrow(/minimum fill must be between 0 and 10,000/);
    expect(() => preparePrivateLiquiditySwapQuote({
      plan: prepare([position({ id: 2, bid: terms(100n, 1n) })]),
      inputAmount: '1',
      slippageBps: 50,
      minimumFillBps: 0
    })).toThrow(/too small/);
  });
});
