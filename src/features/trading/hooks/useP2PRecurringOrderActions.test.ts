import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { TradeSnapshot } from '../../../lib/appShared';

import useP2PRecurringOrderActions from './useP2PRecurringOrderActions';

const OWNER = '0x1111111111111111111111111111111111111111';
const PUBLIC = '0x2222222222222222222222222222222222222222';
const PRIVATE = '0x3333333333333333333333333333333333333333';
const TOKEN_A = '0x4444444444444444444444444444444444444444';
const TOKEN_B = '0x5555555555555555555555555555555555555555';
const TX = `0x${'66'.repeat(32)}`;
type Args = Parameters<typeof useP2PRecurringOrderActions>[0];
type Protocol = 'recurring-v2' | 'private-recurring-v2';

const setup = (protocol: Protocol = 'recurring-v2', edit = false) => {
  const kind = protocol === 'recurring-v2' ? 'erc20' : 'private-erc20';
  const contractAddress = protocol === 'recurring-v2' ? PUBLIC : PRIVATE;
  const base = { kind, tokenAddress: TOKEN_A, symbol: 'A', decimals: 0, amount: '100' };
  const quote = { kind, tokenAddress: TOKEN_B, symbol: 'B', decimals: 0, amount: '200' };
  const snapshot = {
    tradeId: 7, escrowContract: contractAddress, maker: OWNER, expiresAt: 0,
    recurringOrder: {
      orderId: 7, mode: protocol === 'recurring-v2' ? 'public' : 'private',
      baseAsset: base, quoteAsset: quote,
      buyTerms: { baseAmount: '1', quoteAmount: '2' },
      sellTerms: { baseAmount: '1', quoteAmount: '3' },
      v2: { protocol, chainId: '7082400', contractAddress, revision: '2' }
    }
  } as TradeSnapshot;
  const runtime = {
    deployments: {
      'recurring-v2': { chainId: '7082400', contractAddress: PUBLIC },
      'private-recurring-v2': { chainId: '7082400', contractAddress: PRIVATE }
    },
    recurring: vi.fn(async () => ({ orderId: '7', transactionHash: TX })),
    privateRecurring: vi.fn(async () => ({ orderId: '7', transactionHash: TX })),
    isCurrent: vi.fn(() => true)
  };
  const value = {
    buildCurrentTradeSurfacePath: vi.fn(() => '/otc/limit'),
    buildTradeShareUrl: vi.fn(() => '/otc/order/recurring/7'),
    clearCounterTrade: vi.fn(), clearEditTrade: vi.fn(),
    combinedBalanceByAssetKey: {}, customTradeTokenInfoByAddress: {},
    counterParentTrade: null, editingTrade: null, editingRecurringOrder: edit ? snapshot : null,
    ensureTradeFunding: vi.fn(async () => undefined),
    navigateToTradePath: vi.fn(), onActionNotice: vi.fn(), onCotiNetwork: true,
    nativeBalanceWei: 100n, rewardTokenBalanceWei: 100n,
    otcV2ActionRuntime: runtime, openTrade: vi.fn(),
    pWispFooterBalanceState: { status: 'locked' },
    recurringAddBuyBudgetInput: '', recurringAddSellInventoryInput: '',
    recurringBuyFillInput: '', recurringSellFillInput: '',
    recurringBuyPriceInput: '2', recurringSellPriceInput: '3',
    recurringRemoveBuyBudgetInput: '', recurringRemoveSellInventoryInput: edit ? '10' : '',
    refreshRecurringV2Trades: vi.fn(), rememberTradeTerminalReturn: vi.fn(),
    runTradeWalletPromptFlow: vi.fn(async <T,>(operation: () => Promise<T>) => operation()),
    setCreatedRecurringOrderId: vi.fn(), setCreatedRecurringOrderLink: vi.fn(),
    setCreatingRecurringOrder: vi.fn(), setEditingRecurringOrder: vi.fn(),
    setRecurringAddBuyBudgetInput: vi.fn(), setRecurringAddSellInventoryInput: vi.fn(),
    setRecurringBuyFillInput: vi.fn(), setRecurringSellFillInput: vi.fn(),
    setRecurringBuyPriceInput: vi.fn(), setRecurringSellPriceInput: vi.fn(),
    setRecurringBuyReceiveEditable: vi.fn(), setRecurringSellReceiveEditable: vi.fn(),
    setRecurringBuyReceiveInput: vi.fn(), setRecurringSellReceiveInput: vi.fn(),
    setRecurringHidePrivateAmounts: vi.fn(),
    setRecurringRemoveBuyBudgetInput: vi.fn(), setRecurringRemoveSellInventoryInput: vi.fn(),
    setTradeActionError: vi.fn(), setTradeCreateMode: vi.fn(),
    setTradeExpiryHoursInput: vi.fn(), setTradeHasNoExpiry: vi.fn(),
    setTradeOfferAmountInput: vi.fn(), setTradeRequestAmountInput: vi.fn(),
    setTradeOfferCustomTokenAddress: vi.fn(), setTradeRequestCustomTokenAddress: vi.fn(),
    setTradeOfferTokenSelection: vi.fn(), setTradeRequestTokenSelection: vi.fn(),
    setTradePriceInput: vi.fn(), setTradePricingEditedFields: vi.fn(),
    startFreshTrade: vi.fn(),
    tradeComposerModel: { selectedTradeOfferToken: base, selectedTradeRequestToken: quote, tradeTokenOptions: [] },
    tradeExpiryHoursInput: '24', tradeHasNoExpiry: true, tradeRequiredFeeWei: 0n,
    walletAddress: OWNER
  };
  let actions: ReturnType<typeof useP2PRecurringOrderActions> | undefined;
  function Harness() {
    actions = useP2PRecurringOrderActions(value as unknown as Args);
    return null;
  }
  renderToStaticMarkup(createElement(Harness));
  if (!actions) throw new Error('Recurring action harness did not render.');
  return { value, runtime, snapshot, actions };
};

describe('retired P2P recurring creation', () => {
  it.each(['recurring-v2', 'private-recurring-v2'] as const)(
    'blocks new %s before funding, privacy work or a wallet prompt', async (protocol) => {
      const { value, runtime, actions } = setup(protocol);
      await actions.createRecurringOrder();
      expect(value.setTradeActionError).toHaveBeenCalledWith(expect.stringContaining('New recurring orders are no longer available'));
      expect(value.onActionNotice).toHaveBeenCalledWith(expect.objectContaining({ status: 'error', surface: 'composer' }));
      expect(value.runTradeWalletPromptFlow).not.toHaveBeenCalled();
      expect(value.ensureTradeFunding).not.toHaveBeenCalled();
      expect(runtime.isCurrent).not.toHaveBeenCalled();
      expect(runtime.recurring).not.toHaveBeenCalled();
      expect(runtime.privateRecurring).not.toHaveBeenCalled();
    }
  );

  it('turns a stale recurring draft into an empty one-off form with a clear error', () => {
    const { value, actions } = setup();
    actions.startFreshRecurringOrder();
    expect(value.setTradeCreateMode).toHaveBeenCalledWith('one-off');
    expect(value.setTradeCreateMode).not.toHaveBeenCalledWith('recurring');
    expect(value.setEditingRecurringOrder).toHaveBeenCalledWith(null);
    expect(value.startFreshTrade).toHaveBeenCalledOnce();
    expect(value.setTradeActionError).toHaveBeenCalledWith(expect.stringContaining('New recurring orders'));
  });

  it('leaves existing order editing for a fresh one-off form without a creation error', () => {
    const { value, actions } = setup('recurring-v2', true);
    actions.clearRecurringEdit();
    expect(value.setTradeCreateMode).toHaveBeenCalledWith('one-off');
    expect(value.setEditingRecurringOrder).toHaveBeenCalledWith(null);
    expect(value.setTradeActionError).not.toHaveBeenCalled();
  });

  it.each(['recurring-v2', 'private-recurring-v2'] as const)(
    'keeps the verified %s close and refund action', async (protocol) => {
      const { value, runtime, snapshot, actions } = setup(protocol, true);
      await actions.updateRecurringOrderStatus(snapshot, 'cancel');
      const writer = protocol === 'recurring-v2' ? runtime.recurring : runtime.privateRecurring;
      expect(writer).toHaveBeenCalledWith({ kind: 'cancel', orderId: 7, expectedRevision: '2' });
      expect(value.ensureTradeFunding).toHaveBeenCalledWith(expect.objectContaining({ requirements: [], confirmationPolicy: 'always' }));
      expect(value.onActionNotice).toHaveBeenCalledWith(expect.objectContaining({ action: 'recurring-close', status: 'success', txHash: TX }));
    }
  );

  it.each(['recurring-v2', 'private-recurring-v2'] as const)(
    'keeps removal of funded inventory from an existing %s order', async (protocol) => {
      const { value, runtime, actions } = setup(protocol, true);
      await actions.createRecurringOrder();
      if (protocol === 'recurring-v2') {
        expect(runtime.recurring).toHaveBeenCalledWith(expect.objectContaining({ kind: 'edit', orderId: 7, baseRemoved: 10n, baseAdded: 0n }));
      } else {
        expect(runtime.privateRecurring).toHaveBeenCalledWith(expect.objectContaining({ kind: 'adjust-liquidity', orderId: 7, base: { direction: 'remove', amount: 10n } }));
      }
      expect([...runtime.recurring.mock.calls, ...runtime.privateRecurring.mock.calls]).not.toEqual(
        expect.arrayContaining([expect.arrayContaining([expect.objectContaining({ kind: 'create' })])])
      );
      expect(value.onActionNotice).toHaveBeenCalledWith(expect.objectContaining({ status: 'success', txHash: TX }));
    }
  );
});
