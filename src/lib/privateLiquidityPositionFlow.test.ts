import { describe, expect, it } from 'vitest';
import type { PrivateLiquidityPosition } from './privateLiquidity';
import {
  buildPrivateLiquidityPositionToken,
  derivePrivateLiquidityPositionCreateDraft,
  orderPrivateLiquidityPositionTokens,
  preparePrivateLiquidityPositionAction
} from './privateLiquidityPositionFlow';

const address = (pair: string): string => `0x${pair.repeat(20)}`;
const hash = (pair: string): string => `0x${pair.repeat(32)}`;

const low = buildPrivateLiquidityPositionToken({
  selection: 'low',
  token: { kind: 'private-erc20', tokenAddress: address('11'), symbol: 'p.LOW', decimals: 6 }
});
const high = buildPrivateLiquidityPositionToken({
  selection: 'high',
  token: { kind: 'private-erc20', tokenAddress: address('22'), symbol: 'p.HIGH', decimals: 6 }
});

const position: PrivateLiquidityPosition = {
  identity: { chainId: '7082400', contractAddress: address('33'), positionId: '7' },
  owner: address('44'),
  pairKey: hash('55'),
  baseToken: low.address,
  quoteToken: high.address,
  buyTerms: { baseAmount: '1000000', quoteAmount: '9000000' },
  sellTerms: { baseAmount: '1000000', quoteAmount: '11000000' },
  status: 'active',
  revision: '4',
  buySideAvailable: true,
  sellSideAvailable: true,
  privacyOwner: address('44'),
  createdAt: '100',
  lastActivityBlock: '120'
};

describe('privateLiquidityPositionFlow', () => {
  it('derives balanced inventory and a symmetric public spread from the simple creation inputs', () => {
    const draft = derivePrivateLiquidityPositionCreateDraft({
      baseToken: low,
      quoteToken: high,
      startingPriceInput: '10',
      spreadPercentInput: '2',
      budgetInput: '5',
      budgetSide: 'base'
    });
    expect(draft).toMatchObject({
      startingPriceInput: '10',
      spreadPercentInput: '2',
      bidPriceInput: '9.9',
      askPriceInput: '10.1',
      buyBaseAmountInput: '1',
      buyQuoteAmountInput: '9.9',
      sellBaseAmountInput: '1',
      sellQuoteAmountInput: '10.1',
      baseInventoryInput: '5',
      quoteInventoryInput: '50'
    });

    const quoteBudget = derivePrivateLiquidityPositionCreateDraft({
      baseToken: low,
      quoteToken: high,
      startingPriceInput: '2.5',
      spreadPercentInput: '5',
      budgetInput: '25',
      budgetSide: 'quote'
    });
    expect(quoteBudget.baseInventoryInput).toBe('10');
    expect(quoteBudget.quoteInventoryInput).toBe('25');
    expect(quoteBudget.bidPriceInput).toBe('2.4375');
    expect(quoteBudget.askPriceInput).toBe('2.5625');
  });

  it('rejects invalid simplified creation inputs before they reach wallet preparation', () => {
    expect(() => derivePrivateLiquidityPositionCreateDraft({
      baseToken: low,
      quoteToken: high,
      startingPriceInput: '0',
      spreadPercentInput: '2',
      budgetInput: '5',
      budgetSide: 'base'
    })).toThrow('Starting price must be positive');
    expect(() => derivePrivateLiquidityPositionCreateDraft({
      baseToken: low,
      quoteToken: high,
      startingPriceInput: '10',
      spreadPercentInput: '101',
      budgetInput: '5',
      budgetSide: 'base'
    })).toThrow('Spread must be between 0% and 100%');
  });

  it('derives canonical tokens and one packed-input create action with only positive approval requirements', () => {
    expect(orderPrivateLiquidityPositionTokens(high, low)).toEqual({ baseToken: low, quoteToken: high });
    const prepared = preparePrivateLiquidityPositionAction({
      kind: 'create',
      firstToken: high,
      secondToken: low,
      buyBaseAmountInput: '1',
      buyQuoteAmountInput: '9',
      sellBaseAmountInput: '1',
      sellQuoteAmountInput: '11',
      baseInventoryInput: '5',
      quoteInventoryInput: '0'
    });
    expect(prepared.action).toMatchObject({
      kind: 'create',
      baseToken: low.address,
      quoteToken: high.address,
      buyTerms: { baseAmount: '1000000', quoteAmount: '9000000' },
      sellTerms: { baseAmount: '1000000', quoteAmount: '11000000' },
      baseInventory: 5_000_000n,
      quoteInventory: 0n
    });
    expect(prepared.requiredApprovals).toEqual([{
      amount: '5000000',
      policy: 'approve-exact',
      token: low
    }]);
    expect(prepared.confirmation.stats).toContainEqual({ label: 'COTI private inputs', value: '1 confirmation' });
    expect(prepared.confirmation.stats).toContainEqual({ label: 'On-chain action', value: '1 transaction' });
    expect(prepared.confirmation.stats).toContainEqual({ label: 'Chat notification', value: '0 transactions' });
    expect(prepared.confirmation.summaryRows[0]).toEqual({ label: 'Pair', value: 'p.LOW / p.HIGH' });
    expect(prepared.confirmation.summaryRows).toContainEqual({
      label: 'Token allowances',
      value: 'Approve only the missing exact amounts'
    });
  });

  it('carries the existing-only allowance policy into every create requirement', () => {
    const prepared = preparePrivateLiquidityPositionAction({
      kind: 'create',
      firstToken: low,
      secondToken: high,
      buyBaseAmountInput: '1',
      buyQuoteAmountInput: '9',
      sellBaseAmountInput: '1',
      sellQuoteAmountInput: '11',
      baseInventoryInput: '1',
      quoteInventoryInput: '1',
      allowancePolicy: 'reuse-existing'
    });
    expect(prepared.requiredApprovals.every(({ policy }) => policy === 'reuse-existing')).toBe(true);
    expect(prepared.confirmation.stats).toContainEqual({ label: 'Token approval', value: 'None' });
    expect(prepared.confirmation.summaryRows).toContainEqual({
      label: 'Token allowances',
      value: 'Use existing allowances only'
    });
  });

  it('rejects crossed prices and empty packed inventory before any wallet operation', () => {
    expect(() => preparePrivateLiquidityPositionAction({
      kind: 'create',
      firstToken: low,
      secondToken: high,
      buyBaseAmountInput: '1',
      buyQuoteAmountInput: '12',
      sellBaseAmountInput: '1',
      sellQuoteAmountInput: '11',
      baseInventoryInput: '1',
      quoteInventoryInput: '1'
    })).toThrow('bid price cannot be above');
    expect(() => preparePrivateLiquidityPositionAction({
      kind: 'create',
      firstToken: low,
      secondToken: high,
      buyBaseAmountInput: '1',
      buyQuoteAmountInput: '9',
      sellBaseAmountInput: '1',
      sellQuoteAmountInput: '11',
      baseInventoryInput: '0',
      quoteInventoryInput: '0'
    })).toThrow('Initial inventory');
  });

  it('prepares revision-bound add and remove actions with exact approval and prompt policy', () => {
    const add = preparePrivateLiquidityPositionAction({
      kind: 'add-liquidity',
      position,
      baseToken: low,
      quoteToken: high,
      baseAmountInput: '2.5',
      quoteAmountInput: '7'
    });
    expect(add.action).toEqual({
      kind: 'add-liquidity',
      positionId: '7',
      expectedRevision: '4',
      baseAmount: 2_500_000n,
      quoteAmount: 7_000_000n
    });
    expect(add.requiredApprovals).toHaveLength(2);
    expect(add.requiresPrivacy).toBe(true);

    const remove = preparePrivateLiquidityPositionAction({
      kind: 'remove-liquidity',
      position,
      baseToken: low,
      quoteToken: high,
      baseAmountInput: '1',
      quoteAmountInput: '0'
    });
    expect(remove.requiredApprovals).toEqual([]);
    expect(remove.confirmation.primaryLabel).toBe('Withdraw liquidity');
  });

  it('binds management actions to the selected position revision and validates transfer recipients', () => {
    const paused = preparePrivateLiquidityPositionAction({ kind: 'pause', position });
    expect(paused.action).toEqual({ kind: 'pause', positionId: '7', expectedRevision: '4' });
    expect(paused.requiresPrivacy).toBe(false);

    const activated = preparePrivateLiquidityPositionAction({
      kind: 'activate-privacy',
      position,
      resume: true
    });
    expect(activated.action).toEqual({
      kind: 'activate-privacy',
      positionId: '7',
      expectedRevision: '4',
      resume: true
    });
    expect(activated.requiresPrivacy).toBe(true);

    expect(() => preparePrivateLiquidityPositionAction({
      kind: 'transfer',
      position,
      recipient: position.owner
    })).toThrow('differ from the current owner');
  });
});
