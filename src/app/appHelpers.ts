import type { ChatWalletPromptEstimate } from '../lib/chatWalletPromptEstimate';
import type { TradeAgentFeeQuote } from '../lib/tradeAgent';
import {
  PRIVATE_TRADE_ESCROW_CONTRACT_ADDRESS,
  type TradeOfferMessagePayload
} from '../lib/appShared';

export const formatTradeAgentFeeLabel = (quote: TradeAgentFeeQuote): string =>
  `${(
    (BigInt(quote.feeAmountWei) + 10n ** BigInt(quote.feeTokenDecimals) - 1n) /
    10n ** BigInt(quote.feeTokenDecimals)
  ).toString()} ${quote.feeTokenSymbol}`;

export const INITIAL_VISIBLE_THREAD_MESSAGE_COUNT = 160;
export const VISIBLE_THREAD_MESSAGE_CHUNK = 120;
export const BACKGROUND_DEEP_SYNC_DELAY_MS = 500;

export const isInChatTradeOffer = (offer: TradeOfferMessagePayload): boolean =>
  !offer.hiddenLiquidity &&
  offer.escrowContract.toLowerCase() !== PRIVATE_TRADE_ESCROW_CONTRACT_ADDRESS.toLowerCase();

export const BROWSER_WALLET_DIRECT_MESSAGE_MAX_LENGTH = 240;
const METAMASK_PROMPT_WARNING_WALLET_PROMPTS = 3;
export const ESTIMATED_DIRECT_TRADE_NOTIFICATION_TRADE_ID = 999_999_999;
export const ESTIMATED_DIRECT_TRADE_ACCESS_SECRET = `0x${'f'.repeat(64)}`;
export const WISP_BRIDGE_WRITE_GAS_LIMIT = 6_000_000n;
export const WISP_BRIDGE_PRIVATE_TOKEN_APPROVAL_GAS_LIMIT = 6_000_000n;

export const resolveMetaMaskPromptEstimateTone = (
  estimate: ChatWalletPromptEstimate
): 'ok' | 'warning' =>
  estimate.likelyMultipart || estimate.estimatedWalletPrompts >= METAMASK_PROMPT_WARNING_WALLET_PROMPTS
    ? 'warning'
    : 'ok';
