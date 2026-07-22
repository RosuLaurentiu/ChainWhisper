import { describe, expect, it } from 'vitest';
import {
  DIRECT_TRADE_ESCROW_CONTRACT_ADDRESS,
  PRIVATE_TRADE_ESCROW_CONTRACT_ADDRESS,
  RECURRING_OTC_CONTRACT_ADDRESS,
  TRADE_ESCROW_CONTRACT_ADDRESS,
  type TradeAssetPayload,
  type TradeSnapshot
} from '../../../lib/appShared';
import { ZERO_TRADE_TAKER_ADDRESS } from '../../../lib/tradePerspective';
import {
  __detailSnapshotMatchesRouteForTest,
  __mergeAccountScopedSnapshotForTest,
  __mergePublicTradeRefreshForTest,
  __resolveTradeDetailAccessDecisionForTest,
  __resolveRenderableDetailTradeForTest,
  __mergeTradeSnapshotEnrichmentForTest,
  __stripWalletScopedTradeSnapshotForTest
} from './useP2PTradeData';
import {
  __shouldFetchPublicFillEventsForWalletForTest,
  __shouldFetchRecurringExecutionRowsForWalletForTest
} from './useP2PPrivateTradeEnrichment';
import { PRIVATE_LINK_SECRET_MISMATCH_MESSAGE } from '../../../lib/tradeLinks';

const maker = '0x1111111111111111111111111111111111111111';
const filler = '0x2222222222222222222222222222222222222222';
const otherFiller = '0x3333333333333333333333333333333333333333';
const routeSecret = `0x${'aa'.repeat(32)}`;
const otherRouteSecret = `0x${'bb'.repeat(32)}`;
const routeSecretHash = `0x${'cc'.repeat(32)}`;
const hashAccessSecret = (secret: string) => (secret.toLowerCase() === routeSecret ? routeSecretHash : `0x${'dd'.repeat(32)}`);

const asset = (symbol: string, amount = '1000000'): TradeAssetPayload => ({
  kind: symbol.startsWith('p') ? 'private-erc20' : 'erc20',
  tokenAddress: `0x${symbol.toLowerCase().padEnd(40, '0').slice(0, 40)}`,
  symbol,
  decimals: 6,
  amount
});

const standardTrade = (overrides: Partial<TradeSnapshot> = {}): TradeSnapshot => ({
  tradeId: 1,
  escrowContract: TRADE_ESCROW_CONTRACT_ADDRESS,
  maker,
  taker: ZERO_TRADE_TAKER_ADDRESS,
  offer: asset('pAAA'),
  request: asset('BBB'),
  createdAt: 1,
  expiresAt: 0,
  status: 'open',
  hiddenLiquidity: true,
  ...overrides
});

const recurringTrade = (overrides: Partial<TradeSnapshot> = {}): TradeSnapshot => ({
  tradeId: 3,
  escrowContract: RECURRING_OTC_CONTRACT_ADDRESS,
  maker,
  taker: ZERO_TRADE_TAKER_ADDRESS,
  offer: asset('pAAA'),
  request: asset('BBB'),
  createdAt: 1,
  expiresAt: 0,
  status: 'open',
  hiddenLiquidity: true,
  recurringOrder: {
    orderId: 3,
    selectedSide: 'sell',
    mode: 'hybrid-private',
    recurringStatus: 'active',
    baseAsset: asset('pAAA'),
    quoteAsset: asset('BBB'),
    buyTerms: { baseAmount: '1000000', quoteAmount: '2000000' },
    sellTerms: { baseAmount: '1000000', quoteAmount: '2500000' },
    publicBaseInventory: '0',
    publicQuoteInventory: '0',
    buySideOpen: true,
    sellSideOpen: true,
    hasPrivateBaseInventory: true,
    hasPrivateQuoteInventory: false,
    executionCount: 1
  },
  ...overrides
});

describe('__mergeTradeSnapshotEnrichmentForTest', () => {
  it('blocks unlisted trade details when a nonparticipant route secret does not match the access hash', () => {
    const decision = __resolveTradeDetailAccessDecisionForTest({
      hashAccessSecret,
      metadata: { accessHash: routeSecretHash, hasAccessHash: true, isPublic: false },
      routeAccessSecret: otherRouteSecret,
      snapshot: standardTrade({ accessHash: routeSecretHash, hasAccessHash: true, isPublic: false }),
      walletKey: otherFiller
    });

    expect(decision).toEqual({ allowed: false, error: PRIVATE_LINK_SECRET_MISMATCH_MESSAGE });
  });

  it('allows unlisted trade details when the route secret matches the access hash', () => {
    const decision = __resolveTradeDetailAccessDecisionForTest({
      hashAccessSecret,
      metadata: { accessHash: routeSecretHash, hasAccessHash: true, isPublic: false },
      routeAccessSecret: routeSecret,
      snapshot: standardTrade({ accessHash: routeSecretHash, hasAccessHash: true, isPublic: false }),
      walletKey: otherFiller
    });

    expect(decision).toEqual({ allowed: true });
  });

  it('allows participants to load their unlisted trade details without a route secret', () => {
    const decision = __resolveTradeDetailAccessDecisionForTest({
      hashAccessSecret,
      metadata: { accessHash: routeSecretHash, hasAccessHash: true, isPublic: false },
      routeAccessSecret: '',
      snapshot: standardTrade({ accessHash: routeSecretHash, hasAccessHash: true, isPublic: false }),
      walletKey: maker
    });

    expect(decision).toEqual({ allowed: true });
  });

  it('allows a readable participant account to load a chat-linked unlisted trade', () => {
    const decision = __resolveTradeDetailAccessDecisionForTest({
      hashAccessSecret,
      metadata: { accessHash: routeSecretHash, hasAccessHash: true, isPublic: false },
      routeAccessSecret: '',
      snapshot: standardTrade({ accessHash: routeSecretHash, hasAccessHash: true, isPublic: false }),
      walletKey: otherFiller,
      walletReadAccounts: [
        {
          address: maker,
          key: maker,
          role: 'owner',
          label: 'Owner wallet',
          canReadPrivate: true,
          isActionAccount: false
        }
      ]
    });

    expect(decision).toEqual({ allowed: true });
  });

  it('does not treat a syntactic route secret as access without a verifiable hash', () => {
    const decision = __resolveTradeDetailAccessDecisionForTest({
      hashAccessSecret,
      metadata: { hasAccessHash: false, isPublic: false },
      routeAccessSecret: routeSecret,
      snapshot: standardTrade({ accessHash: undefined, hasAccessHash: false, isPublic: false }),
      walletKey: otherFiller
    });

    expect(decision).toEqual({ allowed: false });
  });

  it('does not render a cached unlisted detail when the route secret changes before validation', () => {
    const snapshot = standardTrade({ accessHash: routeSecretHash, hasAccessHash: true, isPublic: false });

    expect(
      __resolveRenderableDetailTradeForTest({
        detailTrade: snapshot,
        routeAccessSecret: otherRouteSecret,
        routeEscrowContract: TRADE_ESCROW_CONTRACT_ADDRESS,
        routeTradeId: snapshot.tradeId,
        routeView: 'trade',
        validatedRouteAccessSecret: routeSecret,
        walletKey: otherFiller
      })
    ).toBeNull();
  });

  it('renders an unlisted detail after the current route secret has been validated', () => {
    const snapshot = standardTrade({ accessHash: routeSecretHash, hasAccessHash: true, isPublic: false });

    expect(
      __resolveRenderableDetailTradeForTest({
        detailTrade: snapshot,
        routeAccessSecret: routeSecret,
        routeEscrowContract: TRADE_ESCROW_CONTRACT_ADDRESS,
        routeTradeId: snapshot.tradeId,
        routeView: 'trade',
        validatedRouteAccessSecret: routeSecret,
        walletKey: otherFiller
      })
    ).toBe(snapshot);
  });

  it('renders participant-owned unlisted details without waiting on a route secret', () => {
    const snapshot = standardTrade({ accessHash: routeSecretHash, hasAccessHash: true, isPublic: false });

    expect(
      __resolveRenderableDetailTradeForTest({
        detailTrade: snapshot,
        routeAccessSecret: otherRouteSecret,
        routeEscrowContract: TRADE_ESCROW_CONTRACT_ADDRESS,
        routeTradeId: snapshot.tradeId,
        routeView: 'trade',
        validatedRouteAccessSecret: '',
        walletKey: maker
      })
    ).toBe(snapshot);
  });

  it('renders a participant-created private detail while the route escrow is still resolving', () => {
    const snapshot = standardTrade({
      accessHash: routeSecretHash,
      escrowContract: PRIVATE_TRADE_ESCROW_CONTRACT_ADDRESS,
      hasAccessHash: true,
      isPublic: false
    });

    expect(
      __resolveRenderableDetailTradeForTest({
        detailTrade: snapshot,
        routeAccessSecret: '',
        routeEscrowContract: undefined,
        routeTradeId: snapshot.tradeId,
        routeView: 'trade',
        validatedRouteAccessSecret: '',
        walletKey: maker
      })
    ).toBe(snapshot);
  });

  it('recognizes a clicked desk snapshot as the active terminal route', () => {
    const snapshot = recurringTrade({ tradeId: 7 });

    expect(__detailSnapshotMatchesRouteForTest(snapshot, 7, RECURRING_OTC_CONTRACT_ADDRESS)).toBe(true);
    expect(__detailSnapshotMatchesRouteForTest(snapshot, 8, RECURRING_OTC_CONTRACT_ADDRESS)).toBe(false);
    expect(__detailSnapshotMatchesRouteForTest(snapshot, 7, DIRECT_TRADE_ESCROW_CONTRACT_ADDRESS)).toBe(false);
  });

  it('keeps revealed one-off private receipts when a lighter refresh arrives', () => {
    const existing = standardTrade({
      privateFillReceipts: [
        {
          fillIndex: 1,
          filler,
          offerAmount: '1000000',
          requestAmount: '2500000',
          txHash: '0xaaa'
        }
      ],
      walletHasFill: true
    });
    const incoming = standardTrade({ privateFillReceipts: undefined, walletHasFill: false });

    const merged = __mergeTradeSnapshotEnrichmentForTest(incoming, existing, filler);

    expect(merged.privateFillReceipts).toHaveLength(1);
    expect(merged.walletHasFill).toBe(true);
  });

  it('marks a filler wallet as filled when private receipts are freshly revealed', () => {
    const incoming = standardTrade({
      privateFillReceipts: [
        {
          fillIndex: 1,
          filler,
          offerAmount: '1000000',
          requestAmount: '2500000',
          txHash: '0xaaa'
        }
      ],
      walletHasFill: false
    });

    const merged = __mergeTradeSnapshotEnrichmentForTest(incoming, undefined, filler);

    expect(merged.privateFillReceipts).toHaveLength(1);
    expect(merged.walletHasFill).toBe(true);
  });

  it('does not preserve one-off private reveal data after wallet-switch stripping', () => {
    const existing = standardTrade({
      makerPrivateProgress: {
        initialOfferAmount: '10000000',
        remainingOfferAmount: '9000000'
      },
      privateFillReceipts: [
        {
          fillIndex: 1,
          filler,
          offerAmount: '1000000',
          requestAmount: '2500000',
          txHash: '0xaaa'
        }
      ],
      walletFillState: {
        offerAmountReceived: '1000000',
        requestAmountPaid: '2500000'
      },
      walletFillEvents: [
        {
          fillIndex: 1,
          filler,
          offerAmount: '1000000',
          requestAmount: '2500000'
        }
      ],
      walletHasFill: true
    });
    const incoming = standardTrade({
      makerPrivateProgress: undefined,
      privateFillReceipts: undefined,
      walletFillEvents: undefined,
      walletFillState: undefined,
      walletHasFill: false
    });

    const merged = __mergeTradeSnapshotEnrichmentForTest(
      incoming,
      __stripWalletScopedTradeSnapshotForTest(existing),
      otherFiller
    );

    expect(merged.makerPrivateProgress).toBeUndefined();
    expect(merged.privateFillReceipts).toBeUndefined();
    expect(merged.walletFillEvents).toBeUndefined();
    expect(merged.walletFillState).toBeUndefined();
    expect(merged.walletHasFill).toBeUndefined();
  });

  it('preserves current-wallet indexed fill details when a lighter refresh arrives', () => {
    const existing = standardTrade({
      walletFillState: {
        offerAmountReceived: '1000000',
        requestAmountPaid: '2500000'
      },
      walletHasFill: true
    });
    const incoming = standardTrade({
      walletFillState: undefined,
      walletHasFill: false
    });

    const merged = __mergeTradeSnapshotEnrichmentForTest(incoming, existing, filler);

    expect(merged.walletFillState).toEqual({
      offerAmountReceived: '1000000',
      requestAmountPaid: '2500000'
    });
    expect(merged.walletHasFill).toBe(true);
  });

  it('preserves public fill event rows when a lighter refresh arrives', () => {
    const existing = standardTrade({
      walletFillEvents: [
        {
          fillIndex: 1,
          filler,
          offerAmount: '1000000',
          requestAmount: '2500000',
          txHash: '0xpartial'
        }
      ],
      walletHasFill: true
    });
    const incoming = standardTrade({ walletFillEvents: undefined, walletHasFill: false });

    const merged = __mergeTradeSnapshotEnrichmentForTest(incoming, existing, filler);

    expect(merged.walletFillEvents).toEqual([
      expect.objectContaining({
        fillIndex: 1,
        filler
      })
    ]);
    expect(merged.walletHasFill).toBe(true);
  });

  it('keeps older public fill event rows when a partial standard refresh arrives', () => {
    const existing = standardTrade({
      walletFillEvents: [
        {
          fillIndex: 1,
          filler,
          offerAmount: '1000000',
          requestAmount: '2500000',
          txHash: '0xpartial-old',
          blockNumber: 10,
          logIndex: 1
        }
      ],
      walletHasFill: true
    });
    const incoming = standardTrade({
      walletFillEvents: [
        {
          fillIndex: 2,
          filler,
          offerAmount: '2000000',
          requestAmount: '5000000',
          txHash: '0xpartial-new',
          blockNumber: 11,
          logIndex: 2
        }
      ],
      walletHasFill: true
    });

    const merged = __mergeTradeSnapshotEnrichmentForTest(incoming, existing, filler);

    expect(merged.walletFillEvents?.map((event) => event.txHash)).toEqual(['0xpartial-old', '0xpartial-new']);
    expect(merged.walletHasFill).toBe(true);
  });

  it('appends a newly refreshed public fill event without duplicating existing standard rows', () => {
    const existing = standardTrade({
      walletFillEvents: [
        {
          fillIndex: 1,
          filler,
          offerAmount: '1000000',
          requestAmount: '2500000',
          txHash: '0xpartial-a',
          blockNumber: 10,
          logIndex: 1
        }
      ],
      walletHasFill: true
    });
    const incoming = standardTrade({
      walletFillEvents: [
        {
          fillIndex: 1,
          filler,
          offerAmount: '1000000',
          requestAmount: '2500000',
          txHash: '0xpartial-a',
          blockNumber: 10,
          logIndex: 1
        },
        {
          fillIndex: 2,
          filler,
          offerAmount: '3000000',
          requestAmount: '7500000',
          txHash: '0xpartial-b',
          blockNumber: 12,
          logIndex: 1
        }
      ],
      walletHasFill: true
    });

    const merged = __mergeTradeSnapshotEnrichmentForTest(incoming, existing, filler);

    expect(merged.walletFillEvents?.map((event) => event.txHash)).toEqual(['0xpartial-a', '0xpartial-b']);
  });

  it('preserves only the current filler public fill event rows', () => {
    const existing = standardTrade({
      walletFillEvents: [
        {
          fillIndex: 1,
          filler,
          offerAmount: '1000000',
          requestAmount: '2500000',
          txHash: '0xpartial-a'
        },
        {
          fillIndex: 2,
          filler: otherFiller,
          offerAmount: '2000000',
          requestAmount: '5000000',
          txHash: '0xpartial-b'
        }
      ],
      walletHasFill: true
    });
    const incoming = standardTrade({ walletFillEvents: undefined, walletHasFill: false });

    const merged = __mergeTradeSnapshotEnrichmentForTest(incoming, existing, otherFiller);

    expect(merged.walletFillEvents).toEqual([
      expect.objectContaining({
        fillIndex: 2,
        filler: otherFiller
      })
    ]);
    expect(merged.walletHasFill).toBe(true);
  });

  it('preserves only the current filler receipts when a lighter one-off refresh arrives', () => {
    const existing = standardTrade({
      privateFillReceipts: [
        {
          fillIndex: 1,
          filler,
          offerAmount: '1000000',
          requestAmount: '2500000',
          txHash: '0xaaa'
        },
        {
          fillIndex: 2,
          filler: otherFiller,
          offerAmount: '2000000',
          requestAmount: '5000000',
          txHash: '0xbbb'
        }
      ],
      walletHasFill: true
    });
    const incoming = standardTrade({ privateFillReceipts: undefined, walletHasFill: false });

    const merged = __mergeTradeSnapshotEnrichmentForTest(incoming, existing, otherFiller);

    expect(merged.privateFillReceipts).toEqual([
      expect.objectContaining({
        fillIndex: 2,
        filler: otherFiller
      })
    ]);
    expect(merged.walletHasFill).toBe(true);
  });

  it('keeps the current public desk when a silent refresh returns a transient empty result', () => {
    const existing = [
      standardTrade({ tradeId: 4, createdAt: 4 }),
      recurringTrade({ tradeId: 2, createdAt: 2 })
    ];

    const merged = __mergePublicTradeRefreshForTest([], existing, true);

    expect(merged).toBe(existing);
  });

  it('allows an explicit public desk refresh to accept an empty result after retry attempts', () => {
    const existing = [standardTrade({ tradeId: 4, createdAt: 4 })];

    const merged = __mergePublicTradeRefreshForTest([], existing, false);

    expect(merged).toEqual([]);
  });

  it('keeps recurring execution history when a lighter refresh arrives', () => {
    const existing = recurringTrade({
      walletHasFill: true,
      recurringOrder: {
        ...recurringTrade().recurringOrder!,
        privateExecutions: [
          {
            fillIndex: 1,
            side: 'sell',
            filler,
            baseAmount: '1000000',
            quoteAmount: '2500000',
            txHash: '0xbbb'
          }
        ],
        makerPrivateInventory: {
          baseInventory: '9000000'
        }
      }
    });
    const incoming = recurringTrade({
      walletHasFill: false,
      recurringOrder: {
        ...recurringTrade().recurringOrder!,
        privateExecutions: []
      }
    });

    const merged = __mergeTradeSnapshotEnrichmentForTest(incoming, existing, maker);

    expect(merged.walletHasFill).toBe(true);
    expect(merged.recurringOrder?.privateExecutions).toHaveLength(1);
    expect(merged.recurringOrder?.makerPrivateInventory?.baseInventory).toBe('9000000');
  });

  it('appends older and newer recurring private fills across refreshes', () => {
    const existing = recurringTrade({
      walletHasFill: true,
      recurringOrder: {
        ...recurringTrade().recurringOrder!,
        executionCount: 2,
        privateExecutions: [
          {
            fillIndex: 1,
            side: 'sell',
            filler,
            baseAmount: '1000000',
            quoteAmount: '2500000',
            txHash: '0xold'
          }
        ]
      }
    });
    const incoming = recurringTrade({
      walletHasFill: true,
      recurringOrder: {
        ...recurringTrade().recurringOrder!,
        executionCount: 2,
        privateExecutions: [
          {
            fillIndex: 2,
            side: 'sell',
            filler,
            baseAmount: '2000000',
            quoteAmount: '5000000',
            txHash: '0xnew'
          }
        ]
      }
    });

    const merged = __mergeTradeSnapshotEnrichmentForTest(incoming, existing, filler);

    expect(merged.recurringOrder?.privateExecutions?.map((execution) => execution.txHash)).toEqual(['0xold', '0xnew']);
  });

  it('appends recurring public fills after chain refresh', () => {
    const existing = recurringTrade({
      walletHasFill: true,
      recurringOrder: {
        ...recurringTrade().recurringOrder!,
        executionCount: 2,
        publicExecutions: [
          {
            fillIndex: 1,
            side: 'buy',
            filler,
            baseAmount: '1000000',
            quoteAmount: '2000000',
            txHash: '0xfirst'
          }
        ]
      }
    });
    const incoming = recurringTrade({
      walletHasFill: true,
      recurringOrder: {
        ...recurringTrade().recurringOrder!,
        executionCount: 2,
        publicExecutions: [
          {
            fillIndex: 2,
            side: 'sell',
            filler,
            baseAmount: '1000000',
            quoteAmount: '2500000',
            txHash: '0xsecond'
          }
        ]
      }
    });

    const merged = __mergeTradeSnapshotEnrichmentForTest(incoming, existing, filler);

    expect(merged.walletHasFill).toBe(true);
    expect(merged.recurringOrder?.publicExecutions?.map((execution) => execution.txHash)).toEqual(['0xfirst', '0xsecond']);
  });

  it('keeps app-wallet recurring history when owner compatibility data merges later', () => {
    const appSnapshot = recurringTrade({
      accountAddress: filler,
      accountRole: 'chainwhisper',
      accountMatches: [{ address: filler, role: 'chainwhisper' }],
      walletHasFill: true,
      recurringOrder: {
        ...recurringTrade().recurringOrder!,
        executionCount: 1,
        privateExecutions: [
          {
            fillIndex: 1,
            side: 'sell',
            filler,
            baseAmount: '1000000',
            quoteAmount: '2500000',
            txHash: '0xapp'
          }
        ]
      }
    });
    const ownerSnapshot = recurringTrade({
      accountAddress: maker,
      accountRole: 'owner',
      accountMatches: [{ address: maker, role: 'owner' }],
      walletHasFill: false,
      recurringOrder: {
        ...recurringTrade().recurringOrder!,
        executionCount: 1,
        privateExecutions: []
      }
    });

    const merged = __mergeAccountScopedSnapshotForTest(ownerSnapshot, appSnapshot, maker);

    expect(merged.accountRole).toBe('chainwhisper');
    expect(merged.accountMatches).toEqual([
      { address: filler, role: 'chainwhisper' },
      { address: maker, role: 'owner' }
    ]);
    expect(merged.recurringOrder?.privateExecutions).toEqual([
      expect.objectContaining({
        fillIndex: 1,
        filler,
        txHash: '0xapp'
      })
    ]);
  });

  it('keeps owner-visible standard fills when owner data merges into an app-wallet snapshot', () => {
    const appSnapshot = standardTrade({
      accountAddress: filler,
      accountRole: 'chainwhisper',
      accountMatches: [{ address: filler, role: 'chainwhisper' }],
      walletHasFill: true,
      walletFillEvents: [
        {
          fillIndex: 1,
          filler,
          offerAmount: '1000000',
          requestAmount: '2500000',
          txHash: '0xapp'
        }
      ]
    });
    const ownerSnapshot = standardTrade({
      accountAddress: maker,
      accountRole: 'owner',
      accountMatches: [{ address: maker, role: 'owner' }],
      walletHasFill: true,
      walletFillEvents: [
        {
          fillIndex: 2,
          filler: otherFiller,
          offerAmount: '2000000',
          requestAmount: '5000000',
          txHash: '0xowner'
        }
      ]
    });

    const merged = __mergeAccountScopedSnapshotForTest(ownerSnapshot, appSnapshot, maker);

    expect(merged.accountRole).toBe('chainwhisper');
    expect(merged.accountMatches).toEqual([
      { address: filler, role: 'chainwhisper' },
      { address: maker, role: 'owner' }
    ]);
    expect(merged.walletFillEvents?.map((event) => event.txHash)).toEqual(['0xapp', '0xowner']);
  });

  it('preserves only current-wallet recurring history when a lighter refresh arrives', () => {
    const existing = recurringTrade({
      walletHasFill: true,
      recurringOrder: {
        ...recurringTrade().recurringOrder!,
        privateExecutions: [
          {
            fillIndex: 1,
            side: 'sell',
            filler,
            baseAmount: '1000000',
            quoteAmount: '2500000',
            txHash: '0xaaa'
          },
          {
            fillIndex: 2,
            side: 'buy',
            filler: otherFiller,
            baseAmount: '2000000',
            quoteAmount: '4000000',
            txHash: '0xbbb'
          }
        ],
        publicExecutions: [
          {
            fillIndex: 3,
            side: 'sell',
            filler,
            baseAmount: '3000000',
            quoteAmount: '7500000',
            txHash: '0xccc'
          },
          {
            fillIndex: 4,
            side: 'buy',
            filler: otherFiller,
            baseAmount: '4000000',
            quoteAmount: '8000000',
            txHash: '0xddd'
          }
        ],
        makerPrivateInventory: {
          baseInventory: '9000000',
          quoteInventory: '5000000'
        }
      }
    });
    const incoming = recurringTrade({
      walletHasFill: false,
      recurringOrder: {
        ...recurringTrade().recurringOrder!,
        privateExecutions: [],
        publicExecutions: []
      }
    });

    const merged = __mergeTradeSnapshotEnrichmentForTest(incoming, existing, otherFiller);

    expect(merged.walletHasFill).toBe(true);
    expect(merged.recurringOrder?.makerPrivateInventory).toBeUndefined();
    expect(merged.recurringOrder?.privateExecutions).toEqual([
      expect.objectContaining({
        fillIndex: 2,
        filler: otherFiller
      })
    ]);
    expect(merged.recurringOrder?.publicExecutions).toEqual([
      expect.objectContaining({
        fillIndex: 4,
        filler: otherFiller
      })
    ]);
  });

  it('keeps recurring filler orders visible before execution rows are revealed', () => {
    const incoming = recurringTrade({
      walletHasFill: true,
      recurringOrder: {
        ...recurringTrade().recurringOrder!,
        privateExecutions: undefined,
        publicExecutions: undefined
      }
    });

    const merged = __mergeTradeSnapshotEnrichmentForTest(incoming, undefined, filler);

    expect(merged.walletHasFill).toBe(true);
    expect(merged.recurringOrder?.privateExecutions).toBeUndefined();
    expect(merged.recurringOrder?.publicExecutions).toBeUndefined();
  });

  it('strips wallet-scoped private reveal data before a wallet switch can reuse it', () => {
    const stripped = __stripWalletScopedTradeSnapshotForTest(
      recurringTrade({
        walletFillState: {
          offerAmountReceived: '1000000',
          requestAmountPaid: '2500000'
        },
        walletHasFill: true,
        makerPrivateProgress: {
          initialOfferAmount: '10000000',
          remainingOfferAmount: '9000000'
        },
        privateFillReceipts: [
          {
            fillIndex: 1,
            filler,
            offerAmount: '1000000',
            requestAmount: '2500000'
          }
        ],
        recurringOrder: {
          ...recurringTrade().recurringOrder!,
          makerPrivateInventory: {
            baseInventory: '9000000'
          },
          privateExecutions: [
            {
              fillIndex: 1,
              side: 'sell',
              filler,
              baseAmount: '1000000',
              quoteAmount: '2500000'
            }
          ],
          publicExecutions: [
            {
              fillIndex: 2,
              side: 'buy',
              filler,
              baseAmount: '1000000',
              quoteAmount: '2000000'
            }
          ]
        }
      })
    );

    expect(stripped.walletHasFill).toBeUndefined();
    expect(stripped.walletFillState).toBeUndefined();
    expect(stripped.makerPrivateProgress).toBeUndefined();
    expect(stripped.privateFillReceipts).toBeUndefined();
    expect(stripped.recurringOrder?.makerPrivateInventory).toBeUndefined();
    expect(stripped.recurringOrder?.privateExecutions).toBeUndefined();
    expect(stripped.recurringOrder?.publicExecutions).toBeUndefined();
  });

  it('strips hydrated Direct trade amounts when switching wallets', () => {
    const stripped = __stripWalletScopedTradeSnapshotForTest(
      standardTrade({
        escrowContract: DIRECT_TRADE_ESCROW_CONTRACT_ADDRESS,
        offer: asset('pWISP', '1200000'),
        request: asset('HOTDOG', '2400000'),
        fillState: {
          filledOfferAmount: '0',
          filledRequestAmount: '0',
          remainingOfferAmount: '1200000',
          remainingRequestAmount: '2400000'
        },
        hiddenLiquidity: false
      })
    );

    expect(stripped.offer.amount).toBe('0');
    expect(stripped.request.amount).toBe('0');
    expect(stripped.fillState).toBeUndefined();
    expect(stripped.hiddenLiquidity).toBe(true);
  });

  it('preserves hydrated Direct trade amounts when a lighter refresh arrives', () => {
    const existing = standardTrade({
      escrowContract: DIRECT_TRADE_ESCROW_CONTRACT_ADDRESS,
      maker,
      taker: filler,
      offer: asset('pWISP', '1200000'),
      request: asset('HOTDOG', '2400000'),
      fillState: {
        remainingOfferAmount: '0',
        remainingRequestAmount: '0',
        filledOfferAmount: '1200000',
        filledRequestAmount: '2400000'
      },
      hiddenLiquidity: false
    });
    const incoming = standardTrade({
      escrowContract: DIRECT_TRADE_ESCROW_CONTRACT_ADDRESS,
      maker,
      taker: filler,
      offer: asset('pWISP', '0'),
      request: asset('HOTDOG', '0'),
      fillState: undefined,
      hiddenLiquidity: true
    });

    const merged = __mergeTradeSnapshotEnrichmentForTest(incoming, existing, maker);

    expect(merged.offer.amount).toBe('1200000');
    expect(merged.request.amount).toBe('2400000');
    expect(merged.fillState?.filledOfferAmount).toBe('1200000');
    expect(merged.hiddenLiquidity).toBe(false);
  });
});

describe('terminal fill-event hydration predicate', () => {
  it('hydrates public fills for registry standard escrows without local reveal state', () => {
    const registryStandardEscrow = '0x1000000000000000000000000000000000000001';

    expect(
      __shouldFetchPublicFillEventsForWalletForTest(
        standardTrade({
          escrowContract: registryStandardEscrow,
          hiddenLiquidity: false,
          offer: asset('AAA'),
          request: asset('BBB'),
          walletHasFill: false,
          walletFillEvents: undefined
        }),
        filler
      )
    ).toBe(true);
  });

  it('hydrates recurring execution events even when the snapshot execution count is stale zero', () => {
    expect(
      __shouldFetchRecurringExecutionRowsForWalletForTest(
        recurringTrade({
          recurringOrder: {
            ...recurringTrade().recurringOrder!,
            executionCount: 0,
            publicExecutions: undefined,
            privateExecutions: undefined
          }
        }),
        maker
      )
    ).toBe(true);
  });
});
