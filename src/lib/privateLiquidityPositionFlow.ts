import { getAddress } from '@coti-io/coti-ethers';
import { formatTokenAmount, parseTokenAmountInput } from './appShared/core';
import type { ResolvedTradeToken } from './appHelpers';
import type {
  PrivateLiquidityPosition,
  PrivateLiquiditySideTerms
} from './privateLiquidity';
import type { PrivateLiquidityPositionAction } from './privateLiquidityActions';
import type { TradeActionConfirmModel } from './tradeActionConfirm';
import { deriveRecurringReceiveAmountInput } from './tradePricing';

export type PrivateLiquidityPositionToken = Readonly<{
  address: string;
  decimals: number;
  selection: string;
  symbol: string;
}>;

export type PrivateLiquidityPositionBudgetSide = 'base' | 'quote';
export type PrivateLiquidityAllowancePolicy = 'approve-exact' | 'reuse-existing';

export type PrivateLiquidityPositionCreateDraft = Readonly<{
  startingPriceInput: string;
  spreadPercentInput: string;
  bidPriceInput: string;
  askPriceInput: string;
  buyBaseAmountInput: string;
  buyQuoteAmountInput: string;
  sellBaseAmountInput: string;
  sellQuoteAmountInput: string;
  baseInventoryInput: string;
  quoteInventoryInput: string;
}>;

export type PrivateLiquidityPositionActionIntent =
  | Readonly<{
      kind: 'create';
      firstToken: PrivateLiquidityPositionToken;
      secondToken: PrivateLiquidityPositionToken;
      buyBaseAmountInput: string;
      buyQuoteAmountInput: string;
      sellBaseAmountInput: string;
      sellQuoteAmountInput: string;
      baseInventoryInput: string;
      quoteInventoryInput: string;
      allowancePolicy?: PrivateLiquidityAllowancePolicy;
    }>
  | Readonly<{
      kind: 'update-terms';
      position: PrivateLiquidityPosition;
      baseToken: PrivateLiquidityPositionToken;
      quoteToken: PrivateLiquidityPositionToken;
      buyBaseAmountInput: string;
      buyQuoteAmountInput: string;
      sellBaseAmountInput: string;
      sellQuoteAmountInput: string;
    }>
  | Readonly<{
      kind: 'add-liquidity' | 'remove-liquidity';
      position: PrivateLiquidityPosition;
      baseToken: PrivateLiquidityPositionToken;
      quoteToken: PrivateLiquidityPositionToken;
      baseAmountInput: string;
      quoteAmountInput: string;
    }>
  | Readonly<{
      kind: 'pause' | 'resume' | 'close';
      position: PrivateLiquidityPosition;
    }>
  | Readonly<{
      kind: 'activate-privacy';
      position: PrivateLiquidityPosition;
      resume: boolean;
    }>
  | Readonly<{
      kind: 'transfer';
      position: PrivateLiquidityPosition;
      recipient: string;
    }>;

export type PrivateLiquidityApprovalRequirement = Readonly<{
  amount: string;
  policy: PrivateLiquidityAllowancePolicy;
  token: PrivateLiquidityPositionToken;
}>;

export type PreparedPrivateLiquidityPositionAction = Readonly<{
  action: PrivateLiquidityPositionAction;
  confirmation: TradeActionConfirmModel;
  requiresPrivacy: boolean;
  requiredApprovals: readonly PrivateLiquidityApprovalRequirement[];
  scopeKey: string;
}>;

const UINT128_MAX = (1n << 128n) - 1n;
const CALCULATION_DECIMALS = 18;
const CALCULATION_SCALE = 10n ** BigInt(CALCULATION_DECIMALS);
const MAX_CREATE_SPREAD_PERCENT = 100n * CALCULATION_SCALE;

const ceilDivide = (numerator: bigint, denominator: bigint): bigint =>
  (numerator + denominator - 1n) / denominator;

const normalizeAddress = (value: string, label: string): string => {
  try {
    return getAddress(value.trim()).toLowerCase();
  } catch {
    throw new Error(`${label} must be a valid EVM address.`);
  }
};

export const buildPrivateLiquidityPositionToken = ({
  selection,
  token
}: {
  selection: string;
  token: ResolvedTradeToken;
}): PrivateLiquidityPositionToken => {
  if (token.kind !== 'private-erc20' || !token.tokenAddress) {
    throw new Error('Position NFTs require verified private ERC-20 tokens.');
  }
  if (!Number.isInteger(token.decimals) || token.decimals < 0 || token.decimals > 30) {
    throw new Error('Private-token decimals are unsupported.');
  }
  const symbol = token.symbol.trim();
  if (!symbol) throw new Error('Private-token symbol is missing.');
  return Object.freeze({
    address: normalizeAddress(token.tokenAddress, `${symbol} token`),
    decimals: token.decimals,
    selection,
    symbol
  });
};

export const orderPrivateLiquidityPositionTokens = (
  first: PrivateLiquidityPositionToken,
  second: PrivateLiquidityPositionToken
): Readonly<{ baseToken: PrivateLiquidityPositionToken; quoteToken: PrivateLiquidityPositionToken }> => {
  if (first.address === second.address) throw new Error('Choose two different private tokens.');
  return BigInt(first.address) < BigInt(second.address)
    ? Object.freeze({ baseToken: first, quoteToken: second })
    : Object.freeze({ baseToken: second, quoteToken: first });
};

export const derivePrivateLiquidityPositionCreateDraft = ({
  baseToken,
  quoteToken,
  startingPriceInput,
  spreadPercentInput,
  budgetInput,
  budgetSide
}: {
  baseToken: PrivateLiquidityPositionToken;
  quoteToken: PrivateLiquidityPositionToken;
  startingPriceInput: string;
  spreadPercentInput: string;
  budgetInput: string;
  budgetSide: PrivateLiquidityPositionBudgetSide;
}): PrivateLiquidityPositionCreateDraft => {
  const startingPrice = parseTokenAmountInput(startingPriceInput, CALCULATION_DECIMALS);
  if (startingPrice === null || startingPrice <= 0n) {
    throw new Error('Starting price must be positive.');
  }
  const spreadPercent = parseTokenAmountInput(spreadPercentInput, CALCULATION_DECIMALS);
  if (spreadPercent === null || spreadPercent < 0n || spreadPercent > MAX_CREATE_SPREAD_PERCENT) {
    throw new Error('Spread must be between 0% and 100%.');
  }

  const budgetToken = budgetSide === 'base' ? baseToken : quoteToken;
  const parsedBudget = parseTokenAmountInput(budgetInput, budgetToken.decimals);
  if (parsedBudget === null || parsedBudget <= 0n || parsedBudget > UINT128_MAX) {
    throw new Error(`Budget must be a positive ${budgetToken.symbol} amount.`);
  }

  const spreadDenominator = 200n * CALCULATION_SCALE;
  const bidPrice = (startingPrice * (spreadDenominator - spreadPercent)) / spreadDenominator;
  const askPrice = ceilDivide(
    startingPrice * (spreadDenominator + spreadPercent),
    spreadDenominator
  );
  if (bidPrice <= 0n || askPrice <= 0n) {
    throw new Error('The selected starting price and spread cannot be represented.');
  }

  const normalizedStartingPriceInput = formatTokenAmount(startingPrice, CALCULATION_DECIMALS, 18);
  const bidPriceInput = formatTokenAmount(bidPrice, CALCULATION_DECIMALS, 18);
  const askPriceInput = formatTokenAmount(askPrice, CALCULATION_DECIMALS, 18);
  let termBaseAmount = 1n;
  let buyQuoteAmountInput = '';
  let sellQuoteAmountInput = '';
  while (termBaseAmount <= 1_000_000_000_000n && (!buyQuoteAmountInput || !sellQuoteAmountInput)) {
    const baseAmountInput = termBaseAmount.toString();
    buyQuoteAmountInput = deriveRecurringReceiveAmountInput({
      side: 'sell',
      liquidityInput: baseAmountInput,
      priceInput: bidPriceInput,
      baseDecimals: baseToken.decimals,
      quoteDecimals: quoteToken.decimals
    });
    sellQuoteAmountInput = deriveRecurringReceiveAmountInput({
      side: 'sell',
      liquidityInput: baseAmountInput,
      priceInput: askPriceInput,
      baseDecimals: baseToken.decimals,
      quoteDecimals: quoteToken.decimals
    });
    if (!buyQuoteAmountInput || !sellQuoteAmountInput) termBaseAmount *= 10n;
  }
  if (!buyQuoteAmountInput || !sellQuoteAmountInput) {
    throw new Error('The selected prices are too small for this token pair.');
  }

  const baseInventoryInput = budgetSide === 'base'
    ? budgetInput
    : deriveRecurringReceiveAmountInput({
        side: 'buy',
        liquidityInput: budgetInput,
        priceInput: normalizedStartingPriceInput,
        baseDecimals: baseToken.decimals,
        quoteDecimals: quoteToken.decimals
      });
  const quoteInventoryInput = budgetSide === 'quote'
    ? budgetInput
    : deriveRecurringReceiveAmountInput({
        side: 'sell',
        liquidityInput: budgetInput,
        priceInput: normalizedStartingPriceInput,
        baseDecimals: baseToken.decimals,
        quoteDecimals: quoteToken.decimals
      });
  if (!baseInventoryInput || !quoteInventoryInput) {
    throw new Error('The matching inventory amount is too small for this token pair.');
  }

  return Object.freeze({
    startingPriceInput: normalizedStartingPriceInput,
    spreadPercentInput: formatTokenAmount(spreadPercent, CALCULATION_DECIMALS, 18),
    bidPriceInput,
    askPriceInput,
    buyBaseAmountInput: termBaseAmount.toString(),
    buyQuoteAmountInput,
    sellBaseAmountInput: termBaseAmount.toString(),
    sellQuoteAmountInput,
    baseInventoryInput,
    quoteInventoryInput
  });
};

const amount = ({
  input,
  label,
  token,
  positive
}: {
  input: string;
  label: string;
  token: PrivateLiquidityPositionToken;
  positive: boolean;
}): bigint => {
  const parsed = parseTokenAmountInput(input, token.decimals);
  if (parsed === null || parsed < 0n || parsed > UINT128_MAX || (positive && parsed === 0n)) {
    throw new Error(`${label} must be ${positive ? 'a positive' : 'a valid'} ${token.symbol} amount.`);
  }
  return parsed;
};

const terms = ({
  baseInput,
  quoteInput,
  baseToken,
  quoteToken,
  label
}: {
  baseInput: string;
  quoteInput: string;
  baseToken: PrivateLiquidityPositionToken;
  quoteToken: PrivateLiquidityPositionToken;
  label: string;
}): Readonly<{ raw: Readonly<{ baseAmount: bigint; quoteAmount: bigint }>; wire: PrivateLiquiditySideTerms }> => {
  const baseAmount = amount({ input: baseInput, label: `${label} base amount`, token: baseToken, positive: true });
  const quoteAmount = amount({ input: quoteInput, label: `${label} quote amount`, token: quoteToken, positive: true });
  return Object.freeze({
    raw: Object.freeze({ baseAmount, quoteAmount }),
    wire: Object.freeze({ baseAmount: baseAmount.toString(), quoteAmount: quoteAmount.toString() })
  });
};

const pairLabel = (base: PrivateLiquidityPositionToken, quote: PrivateLiquidityPositionToken): string =>
  `${base.symbol} / ${quote.symbol}`;

const display = (value: bigint, token: PrivateLiquidityPositionToken): string =>
  `${formatTokenAmount(value, token.decimals, 8)} ${token.symbol}`;

const promptStats = (privateInputCount: number, approvalCount: number) => [
  {
    label: 'COTI private inputs',
    value: privateInputCount === 0
      ? '0 confirmations'
      : `${privateInputCount} confirmation${privateInputCount === 1 ? '' : 's'}`
  },
  { label: 'On-chain action', value: '1 transaction' },
  {
    label: 'Token approval',
    value: approvalCount
      ? `Up to ${approvalCount} if needed (1 transaction each; private-only approval also adds 1 COTI confirmation)`
      : 'None'
  },
  { label: 'Chat notification', value: '0 transactions' }
];

const confirmation = ({
  title,
  message,
  primaryLabel,
  summaryRows,
  privateInputCount,
  approvalCount
}: {
  title: string;
  message: string;
  primaryLabel: string;
  summaryRows: TradeActionConfirmModel['summaryRows'];
  privateInputCount: number;
  approvalCount: number;
}): TradeActionConfirmModel => Object.freeze({
  title,
  message,
  primaryLabel,
  summaryRows,
  fundingMoves: [],
  stats: promptStats(privateInputCount, approvalCount)
});

const positionIdentity = (position: PrivateLiquidityPosition) => ({
  positionId: position.identity.positionId,
  expectedRevision: position.revision
});

const positionScope = (position: PrivateLiquidityPosition): string => [
  position.identity.chainId,
  position.identity.contractAddress,
  position.identity.positionId,
  position.revision
].join(':');

export const preparePrivateLiquidityPositionAction = (
  intent: PrivateLiquidityPositionActionIntent
): PreparedPrivateLiquidityPositionAction => {
  if (intent.kind === 'create') {
    const { baseToken, quoteToken } = orderPrivateLiquidityPositionTokens(intent.firstToken, intent.secondToken);
    const buy = terms({
      baseInput: intent.buyBaseAmountInput,
      quoteInput: intent.buyQuoteAmountInput,
      baseToken,
      quoteToken,
      label: 'Bid'
    });
    const sell = terms({
      baseInput: intent.sellBaseAmountInput,
      quoteInput: intent.sellQuoteAmountInput,
      baseToken,
      quoteToken,
      label: 'Ask'
    });
    if (buy.raw.quoteAmount * sell.raw.baseAmount > sell.raw.quoteAmount * buy.raw.baseAmount) {
      throw new Error('The bid price cannot be above the ask price.');
    }
    const baseInventory = amount({
      input: intent.baseInventoryInput,
      label: 'Initial base inventory',
      token: baseToken,
      positive: false
    });
    const quoteInventory = amount({
      input: intent.quoteInventoryInput,
      label: 'Initial quote inventory',
      token: quoteToken,
      positive: false
    });
    if (baseInventory === 0n && quoteInventory === 0n) {
      throw new Error('Initial inventory must include at least one positive amount.');
    }
    const allowancePolicy = intent.allowancePolicy ?? 'approve-exact';
    const requiredApprovals = Object.freeze([
      ...(baseInventory > 0n ? [{ amount: baseInventory.toString(), policy: allowancePolicy, token: baseToken }] : []),
      ...(quoteInventory > 0n ? [{ amount: quoteInventory.toString(), policy: allowancePolicy, token: quoteToken }] : [])
    ]);
    const action: PrivateLiquidityPositionAction = Object.freeze({
      kind: 'create',
      baseToken: baseToken.address,
      quoteToken: quoteToken.address,
      buyTerms: buy.wire,
      sellTerms: sell.wire,
      baseInventory,
      quoteInventory
    });
    const scopeKey = [
      'create', baseToken.address, quoteToken.address,
      buy.raw.baseAmount, buy.raw.quoteAmount, sell.raw.baseAmount, sell.raw.quoteAmount,
      baseInventory, quoteInventory
    ].join(':');
    return Object.freeze({
      action,
      requiresPrivacy: true,
      requiredApprovals,
      scopeKey,
      confirmation: confirmation({
        title: 'Create Position NFT',
        message: 'Review the public prices and private deposits. Inventory amounts are packed into one COTI private input.',
        primaryLabel: 'Create Position NFT',
        privateInputCount: 1,
        approvalCount: allowancePolicy === 'approve-exact' ? requiredApprovals.length : 0,
        summaryRows: [
          { label: 'Pair', value: pairLabel(baseToken, quoteToken) },
          { label: 'Bid', value: `${display(buy.raw.baseAmount, baseToken)} for ${display(buy.raw.quoteAmount, quoteToken)}` },
          { label: 'Ask', value: `${display(sell.raw.baseAmount, baseToken)} for ${display(sell.raw.quoteAmount, quoteToken)}` },
          { label: 'Private deposit', value: `${display(baseInventory, baseToken)} + ${display(quoteInventory, quoteToken)}` },
          {
            label: 'Token allowances',
            value: allowancePolicy === 'approve-exact'
              ? 'Approve only the missing exact amounts'
              : 'Use existing allowances only'
          }
        ]
      })
    });
  }

  const identity = positionIdentity(intent.position);
  const basePairSummary = [{ label: 'Position NFT', value: `#${identity.positionId} · revision ${identity.expectedRevision}` }];
  if (intent.kind === 'update-terms') {
    const buy = terms({
      baseInput: intent.buyBaseAmountInput,
      quoteInput: intent.buyQuoteAmountInput,
      baseToken: intent.baseToken,
      quoteToken: intent.quoteToken,
      label: 'Bid'
    });
    const sell = terms({
      baseInput: intent.sellBaseAmountInput,
      quoteInput: intent.sellQuoteAmountInput,
      baseToken: intent.baseToken,
      quoteToken: intent.quoteToken,
      label: 'Ask'
    });
    if (buy.raw.quoteAmount * sell.raw.baseAmount > sell.raw.quoteAmount * buy.raw.baseAmount) {
      throw new Error('The bid price cannot be above the ask price.');
    }
    const action: PrivateLiquidityPositionAction = Object.freeze({
      kind: intent.kind,
      ...identity,
      buyTerms: buy.wire,
      sellTerms: sell.wire
    });
    return Object.freeze({
      action,
      requiresPrivacy: false,
      requiredApprovals: Object.freeze([]),
      scopeKey: `${positionScope(intent.position)}:update:${buy.raw.baseAmount}:${buy.raw.quoteAmount}:${sell.raw.baseAmount}:${sell.raw.quoteAmount}`,
      confirmation: confirmation({
        title: 'Update public prices',
        message: 'The position revision is checked on-chain, so stale price edits fail closed.',
        primaryLabel: 'Update prices',
        privateInputCount: 0,
        approvalCount: 0,
        summaryRows: [
          ...basePairSummary,
          { label: 'Bid', value: `${display(buy.raw.baseAmount, intent.baseToken)} for ${display(buy.raw.quoteAmount, intent.quoteToken)}` },
          { label: 'Ask', value: `${display(sell.raw.baseAmount, intent.baseToken)} for ${display(sell.raw.quoteAmount, intent.quoteToken)}` }
        ]
      })
    });
  }

  if (intent.kind === 'add-liquidity' || intent.kind === 'remove-liquidity') {
    const baseAmount = amount({
      input: intent.baseAmountInput,
      label: intent.kind === 'add-liquidity' ? 'Base deposit' : 'Base withdrawal',
      token: intent.baseToken,
      positive: false
    });
    const quoteAmount = amount({
      input: intent.quoteAmountInput,
      label: intent.kind === 'add-liquidity' ? 'Quote deposit' : 'Quote withdrawal',
      token: intent.quoteToken,
      positive: false
    });
    if (baseAmount === 0n && quoteAmount === 0n) throw new Error('Enter at least one positive liquidity amount.');
    const requiredApprovals = intent.kind === 'add-liquidity'
      ? Object.freeze([
          ...(baseAmount > 0n ? [{ amount: baseAmount.toString(), policy: 'approve-exact' as const, token: intent.baseToken }] : []),
          ...(quoteAmount > 0n ? [{ amount: quoteAmount.toString(), policy: 'approve-exact' as const, token: intent.quoteToken }] : [])
        ])
      : Object.freeze([]);
    const action: PrivateLiquidityPositionAction = Object.freeze({
      kind: intent.kind,
      ...identity,
      baseAmount,
      quoteAmount
    });
    const adding = intent.kind === 'add-liquidity';
    return Object.freeze({
      action,
      requiresPrivacy: true,
      requiredApprovals,
      scopeKey: `${positionScope(intent.position)}:${intent.kind}:${baseAmount}:${quoteAmount}`,
      confirmation: confirmation({
        title: adding ? 'Add private liquidity' : 'Withdraw private liquidity',
        message: adding
          ? 'Both deposits are packed into one COTI private input and remain hidden after custody transfer.'
          : 'Both withdrawal amounts are packed into one COTI private input and sent only to the current NFT owner.',
        primaryLabel: adding ? 'Add liquidity' : 'Withdraw liquidity',
        privateInputCount: 1,
        approvalCount: requiredApprovals.length,
        summaryRows: [
          ...basePairSummary,
          { label: adding ? 'Private deposit' : 'Private withdrawal', value: `${display(baseAmount, intent.baseToken)} + ${display(quoteAmount, intent.quoteToken)}` }
        ]
      })
    });
  }

  let action: PrivateLiquidityPositionAction;
  let title: string;
  let message: string;
  let primaryLabel: string;
  let scopeSuffix = '';
  if (intent.kind === 'transfer') {
    const recipient = normalizeAddress(intent.recipient, 'Transfer recipient');
    if (recipient === intent.position.owner) throw new Error('Transfer recipient must differ from the current owner.');
    action = Object.freeze({ kind: intent.kind, ...identity, recipient });
    title = 'Transfer Position NFT';
    message = 'The recipient becomes the owner, but must activate COTI privacy before the position can trade again.';
    primaryLabel = 'Transfer NFT';
    scopeSuffix = recipient;
  } else if (intent.kind === 'activate-privacy') {
    action = Object.freeze({ kind: intent.kind, ...identity, resume: intent.resume });
    title = 'Activate position privacy';
    message = 'The contract re-encrypts the current private inventory for this connected owner.';
    primaryLabel = intent.resume ? 'Activate and resume' : 'Activate privacy';
  } else {
    action = Object.freeze({ kind: intent.kind, ...identity });
    title = intent.kind === 'pause'
      ? 'Pause Position NFT'
      : intent.kind === 'resume'
        ? 'Resume Position NFT'
        : 'Close Position NFT';
    message = intent.kind === 'close'
      ? 'Closing is permanent and withdraws all remaining private inventory to the current owner.'
      : `This changes the public trading status at revision ${identity.expectedRevision}.`;
    primaryLabel = intent.kind === 'pause'
      ? 'Pause position'
      : intent.kind === 'resume'
        ? 'Resume position'
        : 'Close and withdraw all';
  }
  return Object.freeze({
    action,
    requiresPrivacy: intent.kind === 'activate-privacy',
    requiredApprovals: Object.freeze([]),
    scopeKey: `${positionScope(intent.position)}:${intent.kind}:${scopeSuffix}`,
    confirmation: confirmation({
      title,
      message,
      primaryLabel,
      privateInputCount: 0,
      approvalCount: 0,
      summaryRows: basePairSummary
    })
  });
};
