import { formatTokenAmount, parseTokenAmountInput } from './appShared/core';
import type { ResolvedTradeToken } from './appHelpers';
import {
  normalizePrivateLiquidityAddress,
  type PrivateLiquidityDirection
} from './privateLiquidity';
import {
  preparePrivateLiquidityCandidates,
  preparePrivateLiquiditySwapQuote,
  type PrivateLiquidityCandidatePlan,
  type PrivateLiquiditySwapQuote
} from './privateLiquidityQuote';
import type { PrivateLiquidityWorkspaceModel } from './privateLiquidityWorkspaceModel';
import type { TradeActionConfirmModel } from './tradeActionConfirm';

export type PreparedPrivateLiquiditySwap = Readonly<{
  plan: PrivateLiquidityCandidatePlan;
  quote: PrivateLiquiditySwapQuote;
  inputToken: ResolvedTradeToken & Readonly<{ kind: 'private-erc20'; tokenAddress: string }>;
  outputToken: ResolvedTradeToken & Readonly<{ kind: 'private-erc20'; tokenAddress: string }>;
}>;

const privateToken = (
  value: ResolvedTradeToken | null,
  label: string
): PreparedPrivateLiquiditySwap['inputToken'] => {
  if (!value || value.kind !== 'private-erc20' || !value.tokenAddress) {
    throw new Error(`${label} must be a supported private token.`);
  }
  return Object.freeze({
    ...value,
    kind: 'private-erc20',
    tokenAddress: normalizePrivateLiquidityAddress(value.tokenAddress, `${label} address`)
  });
};

/**
 * Builds the executable best-price-first route from one complete, same-block public position
 * projection. It deliberately makes no private-depth claim.
 */
export const preparePrivateLiquiditySwap = ({
  chainId,
  contractAddress,
  model,
  sellToken,
  buyToken,
  sellAmountInput,
  slippageBps,
  minimumFillBps
}: {
  chainId: string;
  contractAddress: string;
  model: PrivateLiquidityWorkspaceModel;
  sellToken: ResolvedTradeToken | null;
  buyToken: ResolvedTradeToken | null;
  sellAmountInput: string;
  slippageBps: number;
  minimumFillBps: number;
}): PreparedPrivateLiquiditySwap => {
  if (!model) throw new Error('Private-liquidity positions are still loading.');
  const inputToken = privateToken(sellToken, 'Spend token');
  const outputToken = privateToken(buyToken, 'Receive token');
  if (inputToken.tokenAddress === outputToken.tokenAddress) {
    throw new Error('Private-liquidity spend and receive tokens must differ.');
  }
  const inputAmount = parseTokenAmountInput(sellAmountInput, inputToken.decimals);
  if (inputAmount === null || inputAmount <= 0n) {
    throw new Error('Enter a valid private-liquidity spend amount.');
  }

  const sellAddress = BigInt(inputToken.tokenAddress);
  const buyAddress = BigInt(outputToken.tokenAddress);
  const baseToken = sellAddress < buyAddress ? inputToken.tokenAddress : outputToken.tokenAddress;
  const quoteToken = sellAddress < buyAddress ? outputToken.tokenAddress : inputToken.tokenAddress;
  const direction: PrivateLiquidityDirection = inputToken.tokenAddress === baseToken
    ? 'base-to-quote'
    : 'quote-to-base';
  const plan = preparePrivateLiquidityCandidates({
    chainId,
    contractAddress,
    baseToken,
    quoteToken,
    direction,
    positions: model.positions
  });
  if (plan.candidates.length === 0) {
    const reversePlan = preparePrivateLiquidityCandidates({
      chainId,
      contractAddress,
      baseToken,
      quoteToken,
      direction: direction === 'base-to-quote' ? 'quote-to-base' : 'base-to-quote',
      positions: model.positions
    });
    if (reversePlan.candidates.length > 0) {
      throw new Error(
        `This direction has no remaining ${outputToken.symbol} inventory. Positions start two-sided, but fills can deplete one side. Flip the tokens to trade the available reverse direction; reverse fills replenish the depleted side.`
      );
    }
    throw new Error('No active NFT liquidity position quotes this private-token pair.');
  }
  const quote = preparePrivateLiquiditySwapQuote({
    plan,
    inputAmount,
    slippageBps,
    minimumFillBps
  });
  return Object.freeze({ plan, quote, inputToken, outputToken });
};

const formatted = (amount: string, token: ResolvedTradeToken): string =>
  `${formatTokenAmount(BigInt(amount), token.decimals, 6)} ${token.symbol}`;

export const buildPrivateLiquiditySwapConfirmation = (
  prepared: PreparedPrivateLiquiditySwap
): TradeActionConfirmModel => {
  const { quote, inputToken, outputToken } = prepared;
  const minimumFill = quote.minimumFillBps === 0
    ? 'Any positive fill'
    : `${quote.minimumFillBps / 100}% of maximum`;
  return Object.freeze({
    title: 'Review private liquidity swap',
    message:
      'Private depth is unknown. The contract fills best price first up to your limit and leaves unused input in your wallet.',
    primaryLabel: 'Confirm private swap',
    fundingMoves: [],
    summaryRows: [
      { label: 'Spend up to', value: formatted(quote.maximumInput, inputToken) },
      {
        label: 'Full-fill output range',
        value: `${formatted(quote.limitFullFillOutput, outputToken)} – ${formatted(quote.bestFullFillOutput, outputToken)}`
      },
      { label: 'Minimum fill', value: minimumFill },
      { label: 'NFT positions', value: `${quote.selectedCandidateCount}` }
    ],
    stats: [
      { label: 'COTI private inputs', value: '1 confirmation' },
      { label: 'On-chain action', value: '1 transaction' },
      {
        label: 'Token approval',
        value: 'If needed: 1 transaction; private-only approval also adds 1 COTI confirmation'
      },
      { label: 'Chat notification', value: '0 transactions' }
    ]
  });
};
