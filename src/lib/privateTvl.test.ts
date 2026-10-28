import { describe, expect, it } from 'vitest';
import { PRIVACY_TOKEN_PAIRS, type PrivacyTokenPair } from './privacyPortal';
import {
  PRIVATE_TVL_BAND_PROXY_BY_CHAIN_ID,
  buildPrivateTvlSnapshot,
  formatPrivateTvlAmount,
  formatPrivateTvlUsd,
  type PrivateTvlBridgeObservation
} from './privateTvl';

const blockHash = `0x${'12'.repeat(32)}`;
const blockTimestamp = 2_000_000n;

const observation = (
  pair: PrivacyTokenPair,
  overrides: Partial<PrivateTvlBridgeObservation> = {}
): PrivateTvlBridgeObservation => ({
  pairId: pair.id,
  chainId: String(pair.chainId),
  bridgeAddress: pair.bridgeAddress,
  blockNumber: '12345',
  blockHash,
  blockTimestamp: blockTimestamp.toString(),
  reserveAtomic: (10n * 10n ** BigInt(pair.publicToken.decimals)).toString(),
  liabilityAtomic: (10n * 10n ** BigInt(pair.publicToken.decimals)).toString(),
  band: {
    base: pair.oracleSymbol,
    quote: 'USD',
    rateE18: (2n * 10n ** 18n).toString(),
    lastUpdatedBase: (blockTimestamp - 100n).toString(),
    lastUpdatedQuote: (blockTimestamp - 50n).toString()
  },
  ...overrides
});

describe('Private TVL model', () => {
  it('builds complete official bridge TVL without double-counting private liabilities', () => {
    const observations = PRIVACY_TOKEN_PAIRS.map((pair, index) => observation(pair, {
      reserveAtomic: (BigInt(index + 1) * 10n ** BigInt(pair.publicToken.decimals)).toString(),
      liabilityAtomic: (BigInt(index + 1) * 10n ** BigInt(pair.publicToken.decimals)).toString()
    }));
    const snapshot = buildPrivateTvlSnapshot({ observations });
    expect(snapshot.totalTokenCount).toBe(7);
    expect(snapshot.pricedTokenCount).toBe(7);
    expect(snapshot.totalUsdValueE18).toBe((56n * 10n ** 18n).toString());
    expect(snapshot.tokens.every((row) => row.coverageStatus === 'exact' && row.coverageBps === '10000')).toBe(true);
    expect(snapshot.bandProxyAddress).toBe(PRIVATE_TVL_BAND_PROXY_BY_CHAIN_ID[2_632_500].toLowerCase());
    expect(() => JSON.stringify(snapshot)).not.toThrow();
  });

  it('uses locked reserve as TVL while reporting liability coverage separately', () => {
    const pair = PRIVACY_TOKEN_PAIRS[0];
    const snapshot = buildPrivateTvlSnapshot({
      expectedPairs: [pair],
      observations: [observation(pair, { reserveAtomic: '12000000000000000000', liabilityAtomic: '10000000000000000000' })]
    });
    expect(snapshot.totalUsdValueE18).toBe((24n * 10n ** 18n).toString());
    expect(snapshot.tokens[0]).toMatchObject({
      reserveAtomic: '12000000000000000000',
      liabilityAtomic: '10000000000000000000',
      coverageStatus: 'overcollateralized',
      coverageBps: '12000'
    });
  });

  it('excludes stale, missing, and future prices from the USD total', () => {
    const [first, second, third] = PRIVACY_TOKEN_PAIRS;
    const snapshot = buildPrivateTvlSnapshot({
      expectedPairs: [first, second, third],
      observations: [
        observation(first),
        observation(second, {
          band: {
            base: second.oracleSymbol,
            quote: 'USD',
            rateE18: (3n * 10n ** 18n).toString(),
            lastUpdatedBase: (blockTimestamp - 4_000n).toString(),
            lastUpdatedQuote: (blockTimestamp - 4_000n).toString()
          }
        }),
        observation(third, { band: null })
      ]
    });
    expect(snapshot.totalUsdValueE18).toBe((20n * 10n ** 18n).toString());
    expect(snapshot.pricedTokenCount).toBe(1);
    expect(snapshot.hasUnpricedValue).toBe(true);
    expect(snapshot.tokens.map(({ priceStatus }) => priceStatus)).toEqual(['ready', 'stale', 'unavailable']);

    const future = buildPrivateTvlSnapshot({
      expectedPairs: [first],
      observations: [observation(first, {
        band: {
          base: first.oracleSymbol,
          quote: 'USD',
          rateE18: (2n * 10n ** 18n).toString(),
          lastUpdatedBase: (blockTimestamp + 1n).toString(),
          lastUpdatedQuote: (blockTimestamp + 1n).toString()
        }
      })]
    });
    expect(future.tokens[0].priceStatus).toBe('unavailable');
    expect(future.tokens[0].usdValueE18).toBeNull();
  });

  it('fails closed on incomplete, duplicate, extra, mixed-block, and mismatched source observations', () => {
    const [first, second] = PRIVACY_TOKEN_PAIRS;
    expect(() => buildPrivateTvlSnapshot({ expectedPairs: [first, second], observations: [observation(first)] }))
      .toThrow(/complete reviewed bridge catalog/i);
    expect(() => buildPrivateTvlSnapshot({
      expectedPairs: [first, second],
      observations: [observation(first), observation(first)]
    })).toThrow(/duplicate/i);
    expect(() => buildPrivateTvlSnapshot({
      expectedPairs: [first],
      observations: [observation(first), observation(second)]
    })).toThrow(/complete reviewed bridge catalog/i);
    expect(() => buildPrivateTvlSnapshot({
      expectedPairs: [first, second],
      observations: [observation(first), observation(second, { blockNumber: '12346' })]
    })).toThrow(/one canonical block/i);
    expect(() => buildPrivateTvlSnapshot({
      expectedPairs: [first],
      observations: [observation(first, { bridgeAddress: second.bridgeAddress })]
    })).toThrow(/does not match the catalog/i);
    expect(() => buildPrivateTvlSnapshot({
      expectedPairs: [first],
      observations: [observation(first, { band: { ...observation(first).band!, base: 'ETH' } })]
    })).toThrow(/symbol mismatch/i);
  });

  it('reports undercollateralized and no-liability bridge states without hiding them', () => {
    const [first, second] = PRIVACY_TOKEN_PAIRS;
    const snapshot = buildPrivateTvlSnapshot({
      expectedPairs: [first, second],
      observations: [
        observation(first, { reserveAtomic: '90', liabilityAtomic: '100' }),
        observation(second, { reserveAtomic: '50', liabilityAtomic: '0' })
      ]
    });
    expect(snapshot.tokens[0]).toMatchObject({ coverageStatus: 'undercollateralized', coverageBps: '9000' });
    expect(snapshot.tokens[1]).toMatchObject({ coverageStatus: 'no-liability', coverageBps: null });
  });

  it('formats large token and USD amounts without converting through floating point', () => {
    expect(formatPrivateTvlAmount({ atomic: '123456789012345678901234', decimals: 18, maximumFractionDigits: 4 }))
      .toBe('123456.789');
    expect(formatPrivateTvlUsd('123456789000000000000')).toBe('123.45');
    expect(() => formatPrivateTvlAmount({ atomic: '1', decimals: 6, maximumFractionDigits: 7 }))
      .toThrow(/precision/i);
  });
});

