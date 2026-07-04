import type { OnboardInfo } from '@coti-io/coti-ethers';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  DIRECT_TRADE_ESCROW_CONTRACT_ADDRESS,
  type TradeAssetPayload,
  type TradeSnapshot
} from '../../../lib/appShared';
import { buildWalletAccountScope } from '../../../lib/walletAccountScope';
import {
  mergeOnboardInfoByAddress,
  resolveVisibleHiddenTermAmounts
} from './P2PTradingPage.helpers';
import {
  buildRecurringTerminalHistoryConfig,
  buildStandardTerminalHistoryConfig,
  resolveTerminalHistoryMergeWalletKey,
  type TerminalHistoryConfigParams
} from './tradeTerminalHistoryConfig';
import TradeStandardOrderCard from './TradeStandardOrderCard';
import { __mergeTradeSnapshotEnrichmentForTest } from '../hooks/useP2PTradeData';

const owner = '0x1111111111111111111111111111111111111111';
const chainwhisper = '0x2222222222222222222222222222222222222222';
const maker = '0x3333333333333333333333333333333333333333';

const asset = (symbol: string, amount = '1000000'): TradeAssetPayload => ({
  kind: symbol.startsWith('p') ? 'private-erc20' : 'erc20',
  tokenAddress: `0x${symbol.toLowerCase().padEnd(40, '0').slice(0, 40)}`,
  symbol,
  decimals: 6,
  amount
});

const terminalHistoryParams = (walletAddress: string): TerminalHistoryConfigParams => {
  const scope = buildWalletAccountScope({
    actionAddress: chainwhisper,
    actionAesReady: true,
    ownerAddress: owner,
    ownerAesReady: true
  });
  return {
    walletAddress,
    walletReadAccounts: scope.readAccounts,
    historyLifecycleTxHashes: {},
    historyTransactionTxHashes: {},
    historyTransactionTimestamps: {},
    swapFillNotes: [],
    getTransactionLinkFeedbackProps: () => ({
      className: '',
      label: 'View Tx',
      onClick: () => {},
      title: 'View transaction'
    })
  };
};

const recurringTrade = (overrides: Partial<TradeSnapshot> = {}): TradeSnapshot =>
  ({
    tradeId: 4,
    maker,
    taker: '0x0000000000000000000000000000000000000000',
    offer: asset('HOTDOG'),
    request: asset('pWISP'),
    createdAt: 1,
    expiresAt: 0,
    status: 'open',
    accountAddress: owner,
    accountRole: 'owner',
    accountMatches: [{ address: owner, role: 'owner' }],
    walletHasFill: true,
    recurringOrder: {
      orderId: 4,
      selectedSide: 'sell',
      mode: 'hybrid-private',
      recurringStatus: 'active',
      baseAsset: asset('HOTDOG'),
      quoteAsset: asset('pWISP'),
      buyTerms: { baseAmount: '1000000', quoteAmount: '125000' },
      sellTerms: { baseAmount: '1000000', quoteAmount: '100000' },
      publicBaseInventory: '0',
      publicQuoteInventory: '0',
      buySideOpen: true,
      sellSideOpen: true,
      hasPrivateBaseInventory: false,
      hasPrivateQuoteInventory: true,
      executionCount: 1,
      publicExecutions: [
        {
          fillIndex: 1,
          side: 'buy',
          filler: chainwhisper,
          baseAmount: '1000000',
          quoteAmount: '125000',
          txHash: '0xabc'
        }
      ]
    },
    ...overrides
  }) as TradeSnapshot;

const standardTrade = (overrides: Partial<TradeSnapshot> = {}): TradeSnapshot =>
  ({
    tradeId: 8,
    maker,
    taker: '0x0000000000000000000000000000000000000000',
    offer: asset('pWISP'),
    request: asset('pCOTI'),
    createdAt: 1,
    expiresAt: 0,
    status: 'open',
    hiddenLiquidity: false,
    accountAddress: chainwhisper,
    accountRole: 'chainwhisper',
    accountMatches: [{ address: chainwhisper, role: 'chainwhisper' }],
    walletHasFill: true,
    walletFillEvents: [
      {
        fillIndex: 1,
        filler: chainwhisper,
        offerAmount: '1000000',
        requestAmount: '1000',
        txHash: '0xapp'
      }
    ],
    ...overrides
  }) as TradeSnapshot;

describe('mergeOnboardInfoByAddress', () => {
  it('returns the same state object when onboard info is unchanged', () => {
    const walletKey = '0x1111111111111111111111111111111111111111';
    const previous = {
      [walletKey]: {
        aesKey: 'aes',
        rsaKey: {
          privateKey: new Uint8Array([1, 2, 3]),
          publicKey: new Uint8Array([4, 5, 6])
        },
        txHash: '0xabc'
      } as OnboardInfo
    };

    const next = mergeOnboardInfoByAddress(previous, walletKey, {
      aesKey: 'aes',
      rsaKey: {
        privateKey: new Uint8Array([1, 2, 3]),
        publicKey: new Uint8Array([4, 5, 6])
      },
      txHash: '0xabc'
    } as OnboardInfo);

    expect(next).toBe(previous);
  });
});

describe('resolveVisibleHiddenTermAmounts', () => {
  it('uses remaining maker liquidity when the original hidden size is not known yet', () => {
    expect(
      resolveVisibleHiddenTermAmounts({
        initialOfferAmount: 0n,
        remainingOfferAmount: 10n,
        offerUnitAmount: 5n,
        requestUnitAmount: 20n
      })
    ).toEqual({ offerAmount: 10n, requestAmount: 40n });
  });
});

describe('buildRecurringTerminalHistoryConfig', () => {
  it('counts recurring fills using the app wallet before owner compatibility history', () => {
    const config = buildRecurringTerminalHistoryConfig(recurringTrade(), terminalHistoryParams(chainwhisper));

    expect(config?.count).toBe(2);
  });

  it('does not fall back to owner recurring fills when the app wallet has history', () => {
    const baseRecurring = recurringTrade().recurringOrder!;
    const config = buildRecurringTerminalHistoryConfig(
      recurringTrade({
        recurringOrder: {
          ...baseRecurring,
          executionCount: 2,
          publicExecutions: [
            ...(baseRecurring.publicExecutions ?? []),
            {
              fillIndex: 2,
              side: 'sell',
              filler: owner,
              baseAmount: '1000000',
              quoteAmount: '100000',
              txHash: '0xowner'
            }
          ]
        }
      }),
      terminalHistoryParams(owner)
    );

    expect(config?.count).toBe(2);
  });

  it('falls back to owner recurring fills when the app wallet has no recurring rows', () => {
    const config = buildRecurringTerminalHistoryConfig(
      recurringTrade({
        recurringOrder: {
          ...recurringTrade().recurringOrder!,
          executionCount: 13,
          publicExecutions: [
            {
              fillIndex: 7,
              side: 'buy',
              filler: owner,
              baseAmount: '1000000',
              quoteAmount: '125000',
              txHash: '0xowner-compat'
            }
          ]
        }
      }),
      terminalHistoryParams(owner)
    );

    expect(config?.count).toBe(2);
  });

  it('falls back to owner maker history when the app wallet has no recurring rows', () => {
    const config = buildRecurringTerminalHistoryConfig(
      recurringTrade({
        maker: owner,
        accountAddress: owner,
        accountRole: 'owner',
        accountMatches: [{ address: owner, role: 'owner' }],
        walletHasFill: false,
        recurringOrder: {
          ...recurringTrade().recurringOrder!,
          publicExecutions: [
            {
              fillIndex: 1,
              side: 'sell',
              filler: maker,
              baseAmount: '1000000',
              quoteAmount: '100000',
              txHash: '0xowner-maker'
            }
          ]
        }
      }),
      terminalHistoryParams(owner)
    );

    expect(config?.count).toBe(2);
  });

  it('shows all recurring fill rows to the maker even when the app wallet also has history', () => {
    const config = buildRecurringTerminalHistoryConfig(
      recurringTrade({
        maker: owner,
        accountAddress: owner,
        accountRole: 'owner',
        accountMatches: [{ address: owner, role: 'owner' }],
        recurringOrder: {
          ...recurringTrade().recurringOrder!,
          executionCount: 2,
          publicExecutions: [
            {
              fillIndex: 1,
              side: 'buy',
              filler: chainwhisper,
              baseAmount: '1000000',
              quoteAmount: '125000',
              txHash: '0xapp-maker-visible'
            },
            {
              fillIndex: 2,
              side: 'sell',
              filler: maker,
              baseAmount: '1000000',
              quoteAmount: '100000',
              txHash: '0xother-maker-visible'
            }
          ]
        }
      }),
      terminalHistoryParams(owner)
    );

    expect(config?.count).toBe(3);
  });
});

describe('buildStandardTerminalHistoryConfig', () => {
  it('keeps owner-visible standard rows when preparing the terminal snapshot', () => {
    const params = terminalHistoryParams(chainwhisper);
    const detailSnapshot = standardTrade({
      maker: owner,
      accountAddress: owner,
      accountRole: 'owner',
      accountMatches: [{ address: owner, role: 'owner' }],
      walletHasFill: false,
      walletFillEvents: undefined
    });
    const walletCopy = standardTrade({
      maker: owner,
      accountAddress: chainwhisper,
      accountRole: 'chainwhisper',
      accountMatches: [
        { address: chainwhisper, role: 'chainwhisper' },
        { address: owner, role: 'owner' }
      ],
      walletFillEvents: [
        ...(standardTrade().walletFillEvents ?? []),
        {
          fillIndex: 2,
          filler: maker,
          offerAmount: '2000000',
          requestAmount: '2000',
          txHash: '0xother'
        }
      ]
    });

    const mergeKey = resolveTerminalHistoryMergeWalletKey(walletCopy, params, chainwhisper);
    const terminalSnapshot = __mergeTradeSnapshotEnrichmentForTest(detailSnapshot, walletCopy, mergeKey);
    const config = buildStandardTerminalHistoryConfig(terminalSnapshot, params);

    expect(mergeKey).toBe(owner);
    expect(config.count).toBe(3);
  });

  it('shows all standard fill rows to the maker when the app wallet also has history', () => {
    const config = buildStandardTerminalHistoryConfig(
      standardTrade({
        maker: owner,
        accountAddress: owner,
        accountRole: 'owner',
        accountMatches: [
          { address: owner, role: 'owner' },
          { address: chainwhisper, role: 'chainwhisper' }
        ],
        walletFillEvents: [
          ...(standardTrade().walletFillEvents ?? []),
          {
            fillIndex: 2,
            filler: maker,
            offerAmount: '2000000',
            requestAmount: '2000',
            txHash: '0xother'
          }
        ]
      }),
      terminalHistoryParams(chainwhisper)
    );

    expect(config.count).toBe(3);
  });

  it('keeps standard filler history scoped to the app wallet when the maker is not connected', () => {
    const config = buildStandardTerminalHistoryConfig(
      standardTrade({
        accountMatches: [
          { address: chainwhisper, role: 'chainwhisper' },
          { address: owner, role: 'owner' }
        ],
        walletFillEvents: [
          ...(standardTrade().walletFillEvents ?? []),
          {
            fillIndex: 2,
            filler: owner,
            offerAmount: '2000000',
            requestAmount: '2000',
            txHash: '0xowner'
          }
        ]
      }),
      terminalHistoryParams(owner)
    );

    expect(config.count).toBe(2);
  });
});

describe('TradeStandardOrderCard', () => {
  it('does not render a manual reveal button for unhydrated Direct OTC terms', () => {
    const scope = buildWalletAccountScope({
      actionAddress: chainwhisper,
      actionAesReady: true,
      ownerAddress: owner,
      ownerAesReady: true
    });

    const markup = renderToStaticMarkup(
      createElement(TradeStandardOrderCard, {
        trade: standardTrade({
          escrowContract: DIRECT_TRADE_ESCROW_CONTRACT_ADDRESS,
          maker: owner,
          taker: chainwhisper,
          offer: asset('pWISP', '0'),
          request: asset('pCOTI', '0'),
          hiddenLiquidity: true,
          accountAddress: chainwhisper,
          accountRole: 'chainwhisper',
          accountMatches: [{ address: chainwhisper, role: 'chainwhisper' }]
        }),
        options: {},
        routeView: 'mine',
        walletAddress: chainwhisper,
        walletKey: chainwhisper.toLowerCase(),
        walletReadAccounts: scope.readAccounts,
        reversedRateTradeIds: {},
        lastCopiedKey: '',
        openTradeSnapshot: () => {},
        toggleTradeRateDirection: () => {},
        resolveKnownTradeAccessSecret: () => '',
        buildTradeShareUrl: () => '',
        copyWithFeedback: async () => {}
      })
    );

    expect(markup).not.toContain('Reveal terms');
  });
});
