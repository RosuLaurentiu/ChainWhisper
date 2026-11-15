import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import TokenSwapPage, { type TokenSwapPageProps } from './TokenSwapPage';
import { PRIVACY_TOKEN_PAIRS } from '../../../lib/privacyPortal';

vi.mock('../../../lib/appShared', async importOriginal => ({
  ...await importOriginal<typeof import('../../../lib/appShared')>(),
  COTI_NETWORK: { chainIdDecimal: 7082400, blockExplorerUrl: 'https://testnet.cotiscan.io' }
}));

const props: TokenSwapPageProps = {
  pairs: PRIVACY_TOKEN_PAIRS, selectedPair: PRIVACY_TOKEN_PAIRS[0], onPairChange: () => {},
  tokenSearch: '', onTokenSearchChange: () => {}, privacyDirection: 'public-to-private',
  onPrivacyDirectionChange: () => {}, amountInput: '', onAmountInputChange: () => {}, onMaxAmount: () => {},
  metrics: null, quote: null, loading: false, actionStage: null,
  walletAddress: '0x1111111111111111111111111111111111111111', onCotiNetwork: true,
  hasAesReady: true, canConvert: true, buttonLabel: 'Convert', onConvert: async () => {},
  onRefresh: () => {}, statusMessage: '', error: ''
};

describe('official bridge on the Testnet App', () => {
  it('uses the bridge chain for its explorer destination', () => {
    const html = renderToStaticMarkup(<TokenSwapPage {...props} />);
    expect(html).toContain(`https://mainnet.cotiscan.io/address/${props.selectedPair.bridgeAddress}#code`);
    expect(html).not.toContain(`https://testnet.cotiscan.io/address/${props.selectedPair.bridgeAddress}`);
  });

  it('keeps unsupported-network guidance consistent and prevents futile actions', () => {
    const html = renderToStaticMarkup(<TokenSwapPage {...props} error="Switch to COTI Mainnet and try again." />);
    expect(html).toContain('Bridge unavailable on this network');
    expect(html).not.toContain('Switch to COTI Mainnet and try again.');
    expect(html).not.toContain('>Retry</button>');
    expect(html).toMatch(/disabled=""[^>]*>Max<\/button>/);
    expect(html).toMatch(/disabled=""[^>]*>Unavailable on this network<\/button>/);
  });
});
