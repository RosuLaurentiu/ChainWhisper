import { formatTokenAmount, parseTokenAmountInput } from './appShared/core';
import {
  preparePrivateLiquidityHiddenIntent,
  type PreparedPrivateLiquidityHiddenIntent,
  type PrivateLiquidityHiddenIntentSide
} from './privateLiquidityHiddenIntents';
import {
  orderPrivateLiquidityPositionTokens,
  type PrivateLiquidityPositionToken
} from './privateLiquidityPositionFlow';
import type { TradeActionConfirmModel } from './tradeActionConfirm';
import { deriveRecurringReceiveAmountInput } from './tradePricing';

export type PrivateLiquidityHiddenIntentDraft = Readonly<{
  firstToken: PrivateLiquidityPositionToken;
  secondToken: PrivateLiquidityPositionToken;
  side: PrivateLiquidityHiddenIntentSide;
  limitBaseAmountInput: string;
  limitQuoteAmountInput: string;
  maximumBudgetInput: string;
  minimumFillBps: number;
  cooldownBlocks: number;
  expiryDays: number;
  currentTimestamp: number;
}>;

export type PreparedPrivateLiquidityHiddenIntentFlow = Readonly<{
  prepared: PreparedPrivateLiquidityHiddenIntent;
  inputToken: PrivateLiquidityPositionToken;
  outputToken: PrivateLiquidityPositionToken;
  maximumBudget: string;
  minimumFill: string;
  confirmation: TradeActionConfirmModel;
  scopeKey: string;
}>;

export type PrivateLiquidityHiddenIntentLimitOrderFields = Readonly<{
  amountInput: string;
  estimatedOutputInput: string;
  limitBaseAmountInput: string;
  limitQuoteAmountInput: string;
  maximumBudgetInput: string;
}>;

const UINT127_MAX = (1n << 127n) - 1n;
const UINT128_MAX = (1n << 128n) - 1n;

const amount = (
  input: string,
  token: PrivateLiquidityPositionToken,
  label: string,
  maximum: bigint
): bigint => {
  const value = parseTokenAmountInput(input, token.decimals);
  if (value === null || value <= 0n || value > maximum) {
    throw new Error(`${label} must be a positive ${token.symbol} amount.`);
  }
  return value;
};

const display = (value: bigint, token: PrivateLiquidityPositionToken): string =>
  `${formatTokenAmount(value, token.decimals, 8)} ${token.symbol}`;

export const derivePrivateLiquidityHiddenIntentLimitOrderFields = ({
  baseToken,
  quoteToken,
  side,
  amountInput,
  limitPriceInput
}: {
  baseToken: PrivateLiquidityPositionToken;
  quoteToken: PrivateLiquidityPositionToken;
  side: PrivateLiquidityHiddenIntentSide;
  amountInput: string;
  limitPriceInput: string;
}): PrivateLiquidityHiddenIntentLimitOrderFields => {
  const baseAmount = amount(amountInput, baseToken, 'Order amount', UINT128_MAX);
  const price = parseTokenAmountInput(limitPriceInput, 18);
  if (price === null || price <= 0n) throw new Error('Limit price must be positive.');
  const normalizedAmountInput = formatTokenAmount(baseAmount, baseToken.decimals, baseToken.decimals);
  const normalizedPriceInput = formatTokenAmount(price, 18, 18);

  let termBaseAmount = 1n;
  let limitQuoteAmountInput = '';
  while (termBaseAmount <= 1_000_000_000_000n && !limitQuoteAmountInput) {
    limitQuoteAmountInput = deriveRecurringReceiveAmountInput({
      side: 'sell',
      liquidityInput: termBaseAmount.toString(),
      priceInput: normalizedPriceInput,
      baseDecimals: baseToken.decimals,
      quoteDecimals: quoteToken.decimals
    });
    if (!limitQuoteAmountInput) termBaseAmount *= 10n;
  }
  if (!limitQuoteAmountInput) throw new Error('The limit price is too small for this token pair.');

  const quoteAtLimit = deriveRecurringReceiveAmountInput({
    side: 'sell',
    liquidityInput: normalizedAmountInput,
    priceInput: normalizedPriceInput,
    baseDecimals: baseToken.decimals,
    quoteDecimals: quoteToken.decimals
  });
  if (!quoteAtLimit) throw new Error('The order total is too small for this token pair.');

  return Object.freeze({
    amountInput: normalizedAmountInput,
    estimatedOutputInput: side === 'sell-base' ? quoteAtLimit : normalizedAmountInput,
    limitBaseAmountInput: termBaseAmount.toString(),
    limitQuoteAmountInput,
    maximumBudgetInput: side === 'sell-base' ? normalizedAmountInput : quoteAtLimit
  });
};

export const preparePrivateLiquidityHiddenIntentFlow = (
  draft: PrivateLiquidityHiddenIntentDraft
): PreparedPrivateLiquidityHiddenIntentFlow => {
  const { baseToken, quoteToken } = orderPrivateLiquidityPositionTokens(
    draft.firstToken,
    draft.secondToken
  );
  const limitBaseAmount = amount(
    draft.limitBaseAmountInput,
    baseToken,
    'Limit base amount',
    UINT127_MAX
  );
  const limitQuoteAmount = amount(
    draft.limitQuoteAmountInput,
    quoteToken,
    'Limit quote amount',
    UINT127_MAX
  );
  const inputToken = draft.side === 'sell-base' ? baseToken : quoteToken;
  const outputToken = draft.side === 'sell-base' ? quoteToken : baseToken;
  const maximumBudget = amount(
    draft.maximumBudgetInput,
    inputToken,
    'Maximum budget',
    UINT128_MAX
  );
  if (!Number.isInteger(draft.minimumFillBps) ||
      draft.minimumFillBps < 0 || draft.minimumFillBps > 10_000) {
    throw new Error('Minimum fill must be between 0% and 100%.');
  }
  if (!Number.isSafeInteger(draft.cooldownBlocks) ||
      draft.cooldownBlocks < 0 || draft.cooldownBlocks > 0xffff_ffff) {
    throw new Error('Cooldown blocks are outside the supported range.');
  }
  if (!Number.isInteger(draft.expiryDays) || draft.expiryDays < 1 || draft.expiryDays > 30 ||
      !Number.isSafeInteger(draft.currentTimestamp) || draft.currentTimestamp <= 0) {
    throw new Error('Hidden-intent expiry must be between 1 and 30 days.');
  }
  const minimumFill = maximumBudget * BigInt(draft.minimumFillBps) / 10_000n;
  const expiresAt = BigInt(draft.currentTimestamp) + BigInt(draft.expiryDays * 86_400);
  const prepared = preparePrivateLiquidityHiddenIntent({
    baseToken: baseToken.address,
    quoteToken: quoteToken.address,
    side: draft.side,
    limitTerms: {
      baseAmount: limitBaseAmount.toString(),
      quoteAmount: limitQuoteAmount.toString()
    },
    maximumBudget,
    minimumFill,
    cooldownBlocks: draft.cooldownBlocks,
    expiresAt,
    currentTimestamp: draft.currentTimestamp
  });
  const sideLabel = draft.side === 'sell-base'
    ? `Sell ${baseToken.symbol} for ${quoteToken.symbol}`
    : `Buy ${baseToken.symbol} with ${quoteToken.symbol}`;
  const minimumLabel = draft.minimumFillBps === 0
    ? 'Any executable partial fill'
    : `${draft.minimumFillBps / 100}% of the original maximum budget per execution (or the final remainder)`;
  return Object.freeze({
    prepared,
    inputToken,
    outputToken,
    maximumBudget: maximumBudget.toString(),
    minimumFill: minimumFill.toString(),
    scopeKey: [
      prepared.pairKey,
      draft.side,
      limitBaseAmount,
      limitQuoteAmount,
      maximumBudget,
      minimumFill,
      draft.cooldownBlocks,
      expiresAt
    ].join(':'),
    confirmation: Object.freeze({
      title: 'Create private limit order',
      message: 'Only the pair, expiry, cooldown, and owner are public. Side, limit price, budget, minimum fill, and execution amounts remain private.',
      primaryLabel: 'Create private limit order',
      summaryRows: [
        { label: 'Private side', value: sideLabel },
        {
          label: 'Private limit',
          value: `${display(limitBaseAmount, baseToken)} for ${display(limitQuoteAmount, quoteToken)}`
        },
        { label: 'Private maximum budget', value: display(maximumBudget, inputToken) },
        { label: 'Private minimum fill', value: minimumLabel },
        {
          label: 'Schedule',
          value: draft.cooldownBlocks === 0
            ? 'Eligible on every settlement call'
            : `At least ${draft.cooldownBlocks} blocks between fills`
        },
        { label: 'Expiry', value: `${draft.expiryDays} day${draft.expiryDays === 1 ? '' : 's'}` }
      ],
      fundingMoves: [],
      stats: [
        { label: 'COTI private inputs', value: '2 packed confirmations' },
        { label: 'On-chain action', value: '1 transaction' },
        {
          label: 'Token approval',
          value: 'If needed: 1 transaction; private-only approval also adds 1 COTI confirmation'
        },
        { label: 'Chat notification', value: '0 transactions' }
      ]
    })
  });
};
