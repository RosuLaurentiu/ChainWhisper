import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PRIVACY_TOKEN_PAIRS } from '../../../lib/privacyPortal';
import { buildPrivateTvlSnapshot, type PrivateTvlBridgeObservation } from '../../../lib/privateTvl';
import { PrivateTvlSnapshotView } from './PrivateTvlPage';

const timestamp = 2_000_000n;
const observations: PrivateTvlBridgeObservation[] = PRIVACY_TOKEN_PAIRS.map((pair) => ({
  pairId: pair.id,
  chainId: String(pair.chainId),
  bridgeAddress: pair.bridgeAddress,
  blockNumber: '100',
  blockHash: `0x${'12'.repeat(32)}`,
  blockTimestamp: timestamp.toString(),
  reserveAtomic: (10n * 10n ** BigInt(pair.publicToken.decimals)).toString(),
  liabilityAtomic: (10n * 10n ** BigInt(pair.publicToken.decimals)).toString(),
  band: {
    base: pair.oracleSymbol,
    quote: 'USD',
    rateE18: (2n * 10n ** 18n).toString(),
    lastUpdatedBase: (timestamp - 5n).toString(),
    lastUpdatedQuote: (timestamp - 4n).toString()
  }
}));

describe('PrivateTvlSnapshotView', () => {
  it('renders official locked reserves, backing, Band prices, and the non-double-counting explanation', () => {
    const markup = renderToStaticMarkup(<PrivateTvlSnapshotView snapshot={buildPrivateTvlSnapshot({ observations })} />);
    expect(markup).toContain('Official Private TVL');
    expect(markup).toContain('$140.00');
    expect(markup).toContain('7/7');
    expect(markup).toContain('TVL by token');
    expect(markup).toContain('Locked reserve');
    expect(markup).toContain('Private liability');
    expect(markup).toContain('Liabilities are reconciled, never counted twice');
    expect(markup.match(/100% backed/g)).toHaveLength(7);
  });

  it('labels incomplete pricing without hiding the unpriced bridge', () => {
    const snapshot = buildPrivateTvlSnapshot({
      observations: observations.map((row, index) => index === 0 ? { ...row, band: null } : row)
    });
    const markup = renderToStaticMarkup(<PrivateTvlSnapshotView snapshot={snapshot} />);
    expect(markup).toContain('The USD total is incomplete');
    expect(markup).toContain('No verified USD reference');
    expect(markup).toContain('Excluded from USD total');
    expect(markup).toContain('COTI / p.COTI');
  });
});

