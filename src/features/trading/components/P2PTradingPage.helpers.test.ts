import type { OnboardInfo } from '@coti-io/coti-ethers';
import { createElement, isValidElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  DIRECT_TRADE_ESCROW_CONTRACT_ADDRESS,
  type TradeAssetPayload,
  type TradeSnapshot
} from '../../../lib/appShared';
import type { TradeHistoryV2ExecutionRow } from '../../../lib/tradeHistoryV2Ledger';
import { buildWalletAccountScope } from '../../../lib/walletAccountScope';
import {
  buildOtcV2DataScopeKey,
  mergeOnboardInfoByAddress,
  renderCarbonPriceReference,
  resolveVisibleHiddenTermAmounts
} from './P2PTradingPage.helpers';
import {
  buildRecurringTerminalHistoryConfig,
  buildStandardTerminalHistoryConfig,
  resolveTerminalHistoryMergeWalletKey,
  type TerminalHistoryConfigParams
} from './tradeTerminalHistoryConfig';
import TradeStandardOrderCard from './TradeStandardOrderCard';
import { TradeTerminalHistoryRows } from './TradeTerminalHistoryPanel';

const owner = '0x1111111111111111111111111111111111111111';
const chainwhisper = '0x2222222222222222222222222222222222222222';
const maker = '0x3333333333333333333333333333333333333333';

it.each(['Verifying exact fill amounts…', 'Exact fill history could not be verified.'])('shows history status before any rows exist: %s', (statusMessage) => {
  const markup = renderToStaticMarkup(createElement(TradeTerminalHistoryRows, {
    lifecycleRows: [], transactionRows: [], historyLifecycleTxHashes: {},
    historyTransactionTxHashes: {}, historyTransactionTimestamps: {}, swapFillNotes: [],
    getTransactionLinkFeedbackProps: () => ({ className: '', label: '', title: '', onClick: () => {} }),
    statusMessage
  }));
  expect(markup).toContain('role="status"');
  expect(markup).toContain(statusMessage);
});

const asset = (symbol: string, amount = '1000000'): TradeAssetPayload => ({
  kind: symbol.startsWith('p') ? 'private-erc20' : 'erc20',
  tokenAddress: `0x${symbol.toLowerCase().padEnd(40, '0').slice(0, 40)}`,
  symbol,
  decimals: 6,
  amount
});

describe('buildOtcV2DataScopeKey', () => {
  it('binds cached projections to the attested deployment and wallet without transient RPC chain state', () => {
    expect(buildOtcV2DataScopeKey({
      deploymentFingerprint: ' COTI-TESTNET:DIRECT-V2 ',
      walletAddress: owner.toUpperCase(),
      walletKey: ''
    })).toBe(`coti-testnet:direct-v2:${owner}`);

    expect(buildOtcV2DataScopeKey({
      deploymentFingerprint: 'coti-testnet:direct-v2',
      walletAddress: chainwhisper,
      walletKey: owner
    })).toBe(`coti-testnet:direct-v2:${owner}`);
  });

  it('changes for a different attested deployment or wallet', () => {
    const current = buildOtcV2DataScopeKey({
      deploymentFingerprint: 'candidate-a',
      walletAddress: owner,
      walletKey: owner
    });

    expect(buildOtcV2DataScopeKey({
      deploymentFingerprint: 'candidate-b',
      walletAddress: owner,
      walletKey: owner
    })).not.toBe(current);
    expect(buildOtcV2DataScopeKey({
      deploymentFingerprint: 'candidate-a',
      walletAddress: chainwhisper,
      walletKey: chainwhisper
    })).not.toBe(current);
  });
});

const terminalHistoryParams = (walletAddress: string): TerminalHistoryConfigParams => {
  const scope = buildWalletAccountScope({
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
    accountRole: 'owner',
    accountMatches: [{ address: chainwhisper, role: 'owner' }],
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

describe('renderCarbonPriceReference', () => {
  it('keeps the price flip control when Carbon has no reference price', () => {
    const onToggle = () => {};
    const node = renderCarbonPriceReference(null, {
      fallbackLabel: 'Carbon price unavailable',
      fallbackTitle: 'Flip ChainWhisper price ratio',
      onToggle,
      pressed: true
    });

    expect(isValidElement(node)).toBe(true);
    if (!isValidElement<{ children: string; onClick: () => void; title: string; 'aria-pressed': boolean }>(node)) {
      throw new Error('Expected a React element');
    }
    expect(node.type).toBe('button');
    expect(node.props.children).toBe('Carbon price unavailable');
    expect(node.props.title).toBe('Flip ChainWhisper price ratio');
    expect(node.props.onClick).toBe(onToggle);
    expect(node.props['aria-pressed']).toBe(true);
  });
});

describe('buildRecurringTerminalHistoryConfig', () => {
  it('shows fills made by the connected wallet', () => {
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

  it('does not show fills belonging to a different wallet', () => {
    const config = buildRecurringTerminalHistoryConfig(recurringTrade(), terminalHistoryParams(owner));
    expect(config?.count).toBe(1);
  });

  it('shows all recurring fill rows to the connected maker', () => {
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
  it('uses the connected wallet as the only terminal-history merge key', () => {
    const params = terminalHistoryParams(owner);
    expect(resolveTerminalHistoryMergeWalletKey(standardTrade(), params, chainwhisper)).toBe(owner);
  });

  it('shows all standard fill rows to the connected maker', () => {
    const config = buildStandardTerminalHistoryConfig(
      standardTrade({
        maker: owner,
        accountAddress: owner,
        accountRole: 'owner',
        accountMatches: [
          { address: owner, role: 'owner' },
          { address: chainwhisper, role: 'owner' }
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

  it('keeps standard filler history scoped to the connected wallet when the maker is not connected', () => {
    const config = buildStandardTerminalHistoryConfig(
      standardTrade({
        accountMatches: [
          { address: chainwhisper, role: 'owner' },
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
          accountRole: 'owner',
          accountMatches: [{ address: chainwhisper, role: 'owner' }]
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

  it('uses canonical participant amounts for an accepted private Direct order card', () => {
    const scope = buildWalletAccountScope({
      ownerAddress: owner,
      ownerAesReady: true
    });
    const canonicalRow: TradeHistoryV2ExecutionRow = {
      key: 'direct-v2-private-acceptance',
      protocol: 'direct-v2',
      order: {
        chainId: '7082400',
        contractAddress: DIRECT_TRADE_ESCROW_CONTRACT_ADDRESS.toLowerCase(),
        orderId: '8'
      },
      sequence: '1',
      maker: owner,
      participant: chainwhisper,
      side: 'accept',
      amountState: 'available',
      amounts: { offerAmount: '1250000', requestAmount: '2500000' },
      source: 'participant-receipt',
      log: {
        blockNumber: '99',
        blockHash: `0x${'11'.repeat(32)}`,
        transactionHash: `0x${'22'.repeat(32)}`,
        transactionIndex: 0,
        logIndex: 1
      }
    };

    const markup = renderToStaticMarkup(
      createElement(TradeStandardOrderCard, {
        trade: standardTrade({
          escrowContract: DIRECT_TRADE_ESCROW_CONTRACT_ADDRESS,
          maker: owner,
          taker: chainwhisper,
          offer: asset('pWISP', '0'),
          request: asset('pCOTI', '0'),
          status: 'accepted',
          hiddenLiquidity: true,
          walletFillEvents: [],
          walletHasFill: false,
          v2: {
            protocol: 'direct-v2',
            chainId: '7082400',
            contractAddress: DIRECT_TRADE_ESCROW_CONTRACT_ADDRESS,
            revision: '1'
          }
        }),
        options: { groupId: 'history' },
        routeView: 'mine',
        walletAddress: owner,
        walletKey: owner.toLowerCase(),
        walletReadAccounts: scope.readAccounts,
        reversedRateTradeIds: {},
        lastCopiedKey: '',
        openTradeSnapshot: () => {},
        toggleTradeRateDirection: () => {},
        resolveKnownTradeAccessSecret: () => '',
        buildTradeShareUrl: () => '',
        copyWithFeedback: async () => {},
        canonicalV2Rows: [canonicalRow]
      })
    );

    expect(markup).toContain('1.25');
    expect(markup).toContain('2.5');
    expect(markup).not.toContain('Private amount');
  });

  it('shows the sum of all exact private fills instead of treating the first fill as the order total', () => {
    const scope = buildWalletAccountScope({ ownerAddress: owner, ownerAesReady: true });
    const contractAddress = DIRECT_TRADE_ESCROW_CONTRACT_ADDRESS.toLowerCase();
    const canonicalRows: TradeHistoryV2ExecutionRow[] = [
      {
        key: 'private-fill-1',
        protocol: 'private-v2',
        order: { chainId: '7082400', contractAddress, orderId: '8' },
        sequence: '1',
        maker: owner,
        participant: chainwhisper,
        side: 'fill',
        amountState: 'available',
        amounts: { offerAmount: '125000', requestAmount: '275000' },
        source: 'participant-receipt',
        log: {
          blockNumber: '99',
          blockHash: `0x${'11'.repeat(32)}`,
          transactionHash: `0x${'22'.repeat(32)}`,
          transactionIndex: 0,
          logIndex: 1
        }
      },
      {
        key: 'private-fill-2',
        protocol: 'private-v2',
        order: { chainId: '7082400', contractAddress, orderId: '8' },
        sequence: '2',
        maker: owner,
        participant: maker,
        side: 'fill',
        amountState: 'available',
        amounts: { offerAmount: '375000', requestAmount: '825000' },
        source: 'participant-receipt',
        log: {
          blockNumber: '100',
          blockHash: `0x${'33'.repeat(32)}`,
          transactionHash: `0x${'44'.repeat(32)}`,
          transactionIndex: 0,
          logIndex: 1
        }
      }
    ];

    const markup = renderToStaticMarkup(
      createElement(TradeStandardOrderCard, {
        trade: standardTrade({
          escrowContract: DIRECT_TRADE_ESCROW_CONTRACT_ADDRESS,
          maker: owner,
          offer: asset('pWISP', '0'),
          request: asset('pCOTI', '0'),
          status: 'accepted',
          hiddenLiquidity: true,
          walletFillEvents: [],
          walletHasFill: false,
          v2: { protocol: 'private-v2', chainId: '7082400', contractAddress, revision: '1' }
        }),
        options: { groupId: 'history' },
        routeView: 'mine',
        walletAddress: owner,
        walletKey: owner.toLowerCase(),
        walletReadAccounts: scope.readAccounts,
        reversedRateTradeIds: {},
        lastCopiedKey: '',
        openTradeSnapshot: () => {},
        toggleTradeRateDirection: () => {},
        resolveKnownTradeAccessSecret: () => '',
        buildTradeShareUrl: () => '',
        copyWithFeedback: async () => {},
        canonicalV2Rows: canonicalRows
      })
    );

    expect(markup).toContain('0.5 pWISP');
    expect(markup).toContain('1.1 pCOTI');
    expect(markup).not.toContain('0.125 pWISP');
    expect(markup).not.toContain('0.275 pCOTI');
  });
});
