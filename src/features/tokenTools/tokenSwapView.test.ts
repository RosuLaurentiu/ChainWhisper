import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import TokenSwapPage from './components/TokenSwapPage';
import {
  buildPrivacyPortalQuoteKey,
  PRIVACY_TOKEN_PAIRS,
  type PrivacyPortalPairMetrics,
  type PrivacyPortalQuote
} from '../../lib/privacyPortal';
import {
  derivePrivacyPortalView,
  deriveTokenSwapView,
  resolveTokenSwapDirectionFallback
} from './tokenSwapView';
import { useTokenToolsStore } from './tokenToolsStore';

const baseInput = {
  hasAesReady: true,
  legacyPrivateRewardTokenBalanceWei: 1_000000n,
  legacyPrivateRewardTokenDecimals: 6,
  legacyPrivateRewardTokenSymbol: 'pWISP',
  loadingRewardBalances: false,
  onCotiNetwork: true,
  privateRewardTokenBalanceWei: 2_000000n,
  privateRewardTokenDecimals: 6,
  privateRewardTokenSymbol: 'pWISP',
  rewardTokenBalanceWei: 3_000000n,
  rewardTokenDecimals: 6,
  rewardTokenSymbol: 'WISP',
  swapAmountInput: '1.5',
  swapDirection: 'unshield' as const,
  swappingTokens: false,
  walletAddress: '0x0000000000000000000000000000000000000001'
};

describe('deriveTokenSwapView', () => {
  it('builds the current pWISP recovery view model', () => {
    const view = deriveTokenSwapView(baseInput);

    expect(view.swapInputSymbol).toBe('pWISP');
    expect(view.swapPrivateRewardTokenSymbol).toBe('pWISP');
    expect(view.parsedSwapAmount).toBe(1_500000n);
    expect(view.canSwapRewardTokens).toBe(true);
    expect(view.swapButtonLabel).toBe('Move to WISP');
    expect(view.canShieldTokens).toBe(true);
    expect(view.tokenToolsSummary).toBe('WISP 3 | pWISP 2');
  });

  it('shows locked private balance when privacy is not ready', () => {
    const view = deriveTokenSwapView({
      ...baseInput,
      hasAesReady: false,
      privateRewardTokenBalanceWei: null
    });

    expect(view.canSwapRewardTokens).toBe(false);
    expect(view.swapButtonLabel).toBe('Unlock privacy');
    expect(view.tokenToolsSummary).toBe('WISP 3 | pWISP locked');
  });

  it('uses legacy private token details for legacy unshield', () => {
    const view = deriveTokenSwapView({
      ...baseInput,
      legacyPrivateRewardTokenSymbol: '',
      swapDirection: 'legacy-unshield'
    });

    expect(view.swapInputSymbol).toBe('p.WISP (old)');
    expect(view.swapPrivateRewardTokenBalanceWei).toBe(1_000000n);
  });

  it('shows selected owner balances when loading is false', () => {
    const view = deriveTokenSwapView({
      ...baseInput,
      rewardTokenBalanceWei: 9_000000n,
      privateRewardTokenBalanceWei: 4_000000n,
      walletAddress: '0x0000000000000000000000000000000000000002'
    });

    expect(view.tokenToolsSummary).toBe('WISP 9 | pWISP 4');
    expect(view.canSwapRewardTokens).toBe(true);
  });

  it('uses selected legacy private balance and label', () => {
    const view = deriveTokenSwapView({
      ...baseInput,
      legacyPrivateRewardTokenBalanceWei: 7_000000n,
      legacyPrivateRewardTokenSymbol: 'pWISP',
      swapDirection: 'legacy-unshield'
    });

    expect(view.swapInputSymbol).toBe('pWISP (old)');
    expect(view.tokenToolsSummary).toBe('WISP 3 | pWISP (old) 7');
  });
});

describe('resolveTokenSwapDirectionFallback', () => {
  it('keeps current WISP shielding when the bridge is enabled', () => {
    expect(
      resolveTokenSwapDirectionFallback({
        canLegacyUnshieldTokens: true,
        canShieldTokens: true,
        canUnshieldTokens: true,
        currentSwapDirectionEnabled: true,
        swapDirection: 'shield'
      })
    ).toBe('shield');
  });

  it('keeps current unshield explicit even when legacy recovery is available', () => {
    expect(
      resolveTokenSwapDirectionFallback({
        canLegacyUnshieldTokens: true,
        canShieldTokens: true,
        canUnshieldTokens: true,
        currentSwapDirectionEnabled: true,
        swapDirection: 'unshield'
      })
    ).toBe('unshield');
  });

  it('keeps current unshield when the wallet has current pWISP', () => {
    expect(
      resolveTokenSwapDirectionFallback({
        canLegacyUnshieldTokens: true,
        canShieldTokens: true,
        canUnshieldTokens: true,
        currentSwapDirectionEnabled: true,
        swapDirection: 'unshield'
      })
    ).toBe('unshield');
  });
});

const privacyPair = PRIVACY_TOKEN_PAIRS[0];
const privacyAccount = '0x0000000000000000000000000000000000000001';
const privacyAmountWei = 100n * 10n ** 18n;
const privacyMetrics: PrivacyPortalPairMetrics = {
  pairId: privacyPair.id,
  account: privacyAccount,
  publicBalanceWei: 500n * 10n ** 18n,
  privateBalanceWei: 80n * 10n ** 18n,
  nativeCotiBalanceWei: 500n * 10n ** 18n,
  publicAllowanceWei: 0n,
  privateAllowanceWei: 0n,
  privatePublicAmountsEnabled: true,
  paused: false,
  depositEnabled: true,
  blacklisted: false,
  bridgeLiquidityWei: 10_000n * 10n ** 18n,
  limits: {
    minDepositWei: 10n * 10n ** 18n,
    maxDepositWei: 1_000n * 10n ** 18n,
    minWithdrawWei: 10n * 10n ** 18n,
    maxWithdrawWei: 1_000n * 10n ** 18n
  },
  verification: {
    pairId: privacyPair.id,
    chainId: privacyPair.chainId,
    status: 'ready',
    issues: [],
    verifiedAt: 1
  },
  readAt: 1
};
const privacyQuote: PrivacyPortalQuote = {
  quoteKey: buildPrivacyPortalQuoteKey({
    chainId: privacyPair.chainId,
    account: privacyAccount,
    pairId: privacyPair.id,
    direction: 'public-to-private',
    amountWei: privacyAmountWei
  }),
  chainId: privacyPair.chainId,
  pairId: privacyPair.id,
  direction: 'public-to-private',
  account: privacyAccount,
  amountWei: privacyAmountWei,
  feeWei: 1n * 10n ** 18n,
  receiveAmountWei: 99n * 10n ** 18n,
  cotiOracleTimestamp: 1n,
  tokenOracleTimestamp: 1n,
  blockTimestamp: 1n,
  minAmountWei: privacyMetrics.limits.minDepositWei,
  maxAmountWei: privacyMetrics.limits.maxDepositWei,
  paused: false,
  depositEnabled: true,
  blacklisted: false,
  bridgeLiquidityWei: privacyMetrics.bridgeLiquidityWei,
  gasEstimate: 21000n,
  gasLimit: 27300n,
  quotedAt: 1
};

describe('derivePrivacyPortalView', () => {
  it('requires an exact account, pair, direction and amount quote', () => {
    const view = derivePrivacyPortalView({
      actionStage: null,
      amountInput: '100',
      direction: 'public-to-private',
      hasAesReady: true,
      loading: false,
      metrics: privacyMetrics,
      onCotiNetwork: true,
      pair: privacyPair,
      quote: privacyQuote,
      walletAddress: privacyAccount
    });

    expect(view.amountWei).toBe(privacyAmountWei);
    expect(view.hasExactQuote).toBe(true);
    expect(view.canConvert).toBe(true);
    expect(view.buttonLabel).toBe('Convert to p.COTI');
  });

  it('fails closed when a quote belongs to another amount', () => {
    const view = derivePrivacyPortalView({
      actionStage: null,
      amountInput: '101',
      direction: 'public-to-private',
      hasAesReady: true,
      loading: false,
      metrics: privacyMetrics,
      onCotiNetwork: true,
      pair: privacyPair,
      quote: privacyQuote,
      walletAddress: privacyAccount
    });

    expect(view.hasExactQuote).toBe(false);
    expect(view.canConvert).toBe(false);
    expect(view.buttonLabel).toBe('Refreshing quote...');
  });

  it('never enables a private conversion while privacy is locked', () => {
    const view = derivePrivacyPortalView({
      actionStage: null,
      amountInput: '100',
      direction: 'public-to-private',
      hasAesReady: false,
      loading: false,
      metrics: { ...privacyMetrics, privateBalanceWei: null },
      onCotiNetwork: true,
      pair: privacyPair,
      quote: privacyQuote,
      walletAddress: privacyAccount
    });

    expect(view.canConvert).toBe(false);
    expect(view.buttonLabel).toBe('Unlock privacy');
  });
});

describe('privacy portal state', () => {
  it('clears the official amount without touching WISP recovery input when pair or direction changes', () => {
    useTokenToolsStore.setState({
      privacyAmountInput: '22',
      swapAmountInput: '3',
      swapStatusMessage: 'Recovery confirmed',
      selectedPrivacyPairId: 'coti',
      privacyDirection: 'public-to-private'
    });

    useTokenToolsStore.getState().setSelectedPrivacyPairId('weth');
    expect(useTokenToolsStore.getState().privacyAmountInput).toBe('');
    expect(useTokenToolsStore.getState().swapAmountInput).toBe('3');
    expect(useTokenToolsStore.getState().swapStatusMessage).toBe('Recovery confirmed');

    useTokenToolsStore.getState().setPrivacyAmountInput('1.5');
    useTokenToolsStore.getState().setPrivacyDirection('private-to-public');
    expect(useTokenToolsStore.getState().privacyAmountInput).toBe('');
    expect(useTokenToolsStore.getState().swapAmountInput).toBe('3');
    expect(useTokenToolsStore.getState().swapStatusMessage).toBe('Recovery confirmed');

    useTokenToolsStore.setState({ privacyAmountInput: '', swapAmountInput: '', swapStatusMessage: '' });
  });
});

describe('TokenSwapPage', () => {
  it('renders WISP in the unified selector and only shows legacy recovery while WISP is selected', () => {
    const pageProps: Parameters<typeof TokenSwapPage>[0] = {
        pairs: PRIVACY_TOKEN_PAIRS,
        selectedPair: privacyPair,
        onPairChange: () => {},
        tokenSearch: '',
        onTokenSearchChange: () => {},
        privacyDirection: 'public-to-private',
        onPrivacyDirectionChange: () => {},
        activePortalAccount: 'chainwhisper',
        showPortalAccountTabs: true,
        onPortalAccountChange: () => {},
        amountInput: '100',
        onAmountInputChange: () => {},
        onMaxAmount: () => {},
        metrics: privacyMetrics,
        quote: privacyQuote,
        loading: false,
        actionStage: null,
        walletAddress: privacyAccount,
        onCotiNetwork: true,
        hasAesReady: true,
        canConvert: true,
        buttonLabel: 'Convert to p.COTI',
        onConvert: async () => {},
        onRefresh: () => {},
        statusMessage: '',
        error: '',
        recovery: {
          open: false,
          onOpenChange: () => {},
          amountInput: '',
          onAmountInputChange: () => {},
          onMaxAmount: () => {},
          inputBalanceLabel: '2 pWISP',
          outputBalanceLabel: '7 WISP',
          direction: 'unshield',
          onDirectionChange: () => {},
          canShield: true,
          canUnshield: true,
          canLegacyUnshield: true,
          publicSymbol: 'WISP',
          privateSymbol: 'pWISP',
          inputSymbol: 'pWISP',
          feeLabel: '—',
          contractUrl: '',
          busy: false,
          actionStage: null,
          canSubmit: false,
          buttonLabel: 'Enter pWISP amount',
          onSubmit: async () => {},
          statusMessage: '',
          error: ''
        }
      };
    const officialHtml = renderToStaticMarkup(createElement(TokenSwapPage, pageProps));
    const wispHtml = renderToStaticMarkup(
      createElement(TokenSwapPage, {
        ...pageProps,
        recovery: pageProps.recovery ? { ...pageProps.recovery, open: true } : undefined
      })
    );

    expect(officialHtml).toContain('Privacy Portal');
    expect(officialHtml).toContain('8 supported tokens');
    expect(officialHtml).toContain('Official COTI bridge');
    expect(officialHtml).toContain('Convert to p.COTI');
    expect(officialHtml).toContain('WISP');
    expect(officialHtml).not.toContain('privacy-legacy-recovery');
    expect(wispHtml).toContain('ChainWhisper bridge');
    expect(wispHtml).toContain('Legacy pWISP');
    expect(wispHtml).toMatch(/privacy-wisp-card[\s\S]*privacy-legacy-recovery/);
    expect(wispHtml).toContain('Balance: 7 WISP');
    expect(wispHtml).not.toContain('Move between WISP and pWISP');
  });
});
