import 'jsr:@supabase/functions-js@2.110.8/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2.110.8';
import { corsHeaders, handleCorsPreflight } from '../_shared/cors.ts';
import { jsonResponse } from '../_shared/chat-image.ts';
import { redactTradeAgentSecrets, redactTradeAgentSecretText } from '../_shared/trade-agent-redaction.ts';
import {
  APP_HELP_MAX_INPUT_TOKENS,
  APP_HELP_MAX_QUESTION_CHARS,
  APP_HELP_OFF_TOPIC_ANSWER,
  APP_HELP_SECRET_ANSWER,
  APP_HELP_UNSUPPORTED_ANSWER,
  buildAppHelpAiResult,
  containsSensitiveAppHelpMaterial,
  getAppHelpSurfacePath,
  getAppHelpTopic,
  matchAppHelpTopics,
  resolveLocalAppHelpAnswer,
  type AppHelpTopic
} from '../_shared/app-help-knowledge.ts';
import {
  COTI_CHAIN_ID,
  TRADE_AGENT_PENDING_LEASE_MS,
  TRADE_AGENT_PROTOCOL,
  TRADE_AGENT_PROTOCOL_VERSION,
  TRADE_AGENT_QUOTE_TTL_MS,
  TRADE_AGENT_RESPONSE_TTL_MS,
  assertFreshTradeAgentRecoverySignature,
  buildTradeAgentAuthorizationMessage,
  buildTradeAgentRecoveryMessage,
  createTradeAgentQuoteToken,
  hashTradeAgentRequest,
  recoverTradeAgentMessageSigner,
  verifyTradeAgentPaymentReceiptData,
  verifyTradeAgentQuoteToken,
  type TradeAgentQuotePayload,
  type TradeAgentReceipt
} from './payment-v2.ts';
import {
  TRADE_AGENT_RESPONSE_JSON_SCHEMA,
  normalizeSafeTradeAgentResponse
} from './trade-agent-response.ts';
import {
  findDisallowedTradeAgentContextMaterial,
  findProhibitedTradeAgentMaterial,
  getKnownTradeAgentPromptTokens,
  getSemanticTradeAgentPreflightError,
  hasUnresolvedTradeAgentPlaceholders
} from './trade-agent-safety.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY') ?? '';
const OPENAI_MODEL = Deno.env.get('OPENAI_MODEL') ?? 'gpt-5-mini';
const APP_HELP_MODEL = Deno.env.get('APP_HELP_MODEL') ?? 'gpt-5-nano';
const APP_HELP_RATE_LIMIT_SECRET = Deno.env.get('APP_HELP_RATE_LIMIT_SECRET') ?? '';
const TRADE_AGENT_QUOTE_SECRET = Deno.env.get('TRADE_AGENT_QUOTE_SECRET') ?? '';
const UNISWAP_API_KEY = Deno.env.get('UNISWAP_API_KEY') ?? '';
const COTI_RPC_URL = Deno.env.get('COTI_RPC_URL') ?? '';

const COTI_CHAIN_ID_HEX = '0x282b34';
const FEE_TOKEN_ADDRESS = '0xb70c55bd0823436F44877DC6A9f46E0C55f2C3A8';
const FEE_RECIPIENT = '0xD5F92B95D6224804FA54BCAE2Ee73b5A4a2D8BbD';
const FEE_TOKEN_DECIMALS = 6;
const CARBON_WISP_USD_RATE_URL =
  Deno.env.get('CARBON_WISP_USD_RATE_URL') ??
  `https://api.carbondefi.xyz/v1/coti/market-rate?address=${FEE_TOKEN_ADDRESS}&convert=USD`;
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const MAX_PROMPT_CHARS = 4_000;
const MAX_CONTEXT_CHARS = 14_000;
const APP_HELP_MAX_OUTPUT_TOKENS = 300;
const ESTIMATED_RESPONSE_TOKENS = Number(Deno.env.get('TRADE_AGENT_ESTIMATED_RESPONSE_TOKENS') ?? '500');
const FEE_MARGIN_BPS = Number(Deno.env.get('TRADE_AGENT_FEE_MARGIN_BPS') ?? '15000');
const MIN_FEE_USD = Number(Deno.env.get('TRADE_AGENT_MIN_FEE_USD') ?? '0.006');
const OPENAI_INPUT_USD_PER_1M = Deno.env.get('TRADE_AGENT_OPENAI_INPUT_USD_PER_1M');
const OPENAI_OUTPUT_USD_PER_1M = Deno.env.get('TRADE_AGENT_OPENAI_OUTPUT_USD_PER_1M');
const ACTION_TYPES = new Set([
  'explain_order',
  'find_price',
  'draft_counter',
  'draft_limit',
  'draft_recurring',
  'review_orders',
  'chat_to_trade'
]);
const MODEL_PRICING_USD_PER_1M = new Map([
  ['gpt-5.5', { input: 5, output: 30 }],
  ['gpt-5.4', { input: 2.5, output: 15 }],
  ['gpt-5.4-mini', { input: 0.75, output: 4.5 }],
  ['gpt-5.4-nano', { input: 0.2, output: 1.25 }],
  ['gpt-5', { input: 1.25, output: 10 }],
  ['gpt-5.1', { input: 1.25, output: 10 }],
  ['gpt-5-mini', { input: 0.25, output: 2 }],
  ['gpt-5-nano', { input: 0.05, output: 0.4 }],
  ['gpt-4.1', { input: 2, output: 8 }],
  ['gpt-4.1-mini', { input: 0.4, output: 1.6 }],
  ['gpt-4.1-nano', { input: 0.1, output: 0.4 }]
]);
const UNISWAP_TOKENS = new Map([
  ['coti', { address: '0xDDB3422497E61e13543BeA06989C0789117555c5', decimals: 18, symbol: 'COTI' }],
  ['gcoti', { address: '0xAf2CA40d3fc4459436D11B94d21FA4b8A89fB51d', decimals: 18, symbol: 'gCOTI' }],
  ['usdc', { address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', decimals: 6, symbol: 'USDC' }],
  ['usdc.e', { address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', decimals: 6, symbol: 'USDC' }],
  ['eth', { address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', decimals: 18, symbol: 'WETH' }],
  ['weth', { address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', decimals: 18, symbol: 'WETH' }],
  ['btc', { address: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', decimals: 8, symbol: 'WBTC' }],
  ['wbtc', { address: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', decimals: 8, symbol: 'WBTC' }]
]);

type TradeAgentAction =
  | 'explain_order'
  | 'find_price'
  | 'draft_counter'
  | 'draft_limit'
  | 'draft_recurring'
  | 'review_orders'
  | 'chat_to_trade';

type TradeAgentPaymentRow = {
  action_type?: string;
  completed_at?: string | null;
  fee_amount_wei?: string;
  fee_recipient?: string;
  fee_token_address?: string;
  id?: number;
  payer_address?: string;
  payment_tx_hash?: string;
  quote_expires_at?: string | null;
  quote_issued_at?: string | null;
  request_hash?: string | null;
  request_id?: string | null;
  response_expires_at?: string | null;
  response_json?: unknown;
  status?: string;
  updated_at?: string;
};

type AppHelpRateLimitRow = {
  allowed?: boolean;
  global_count?: number;
  reason?: string;
  user_count?: number;
};

const buildErrorResponse = (message: string, status = 400): Response =>
  jsonResponse({ error: message }, { status, headers: corsHeaders });

const normalizeString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');
const isHexHash = (value: string): boolean => /^0x[a-fA-F0-9]{64}$/.test(value);
const isAddress = (value: string): boolean => /^0x[a-fA-F0-9]{40}$/.test(value);
const isRequestId = (value: string): boolean =>
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(value);
const normalizeAddress = (value: string): string => value.trim().toLowerCase();

const getForwardedClientIp = (request: Request): string => {
  const forwardedFor = request.headers.get('x-forwarded-for') ?? '';
  const firstAddress = forwardedFor.split(',', 1)[0]?.trim() ?? '';
  return firstAddress && firstAddress.length <= 128 ? firstAddress : '';
};

const hashAppHelpClientIp = async (clientIp: string): Promise<string> => {
  if (!APP_HELP_RATE_LIMIT_SECRET || APP_HELP_RATE_LIMIT_SECRET.length < 32) {
    throw new Error('App Help rate limiting is not configured.');
  }
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(APP_HELP_RATE_LIMIT_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const digest = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(clientIp)));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
};

const claimAppHelpQuota = async (request: Request): Promise<Response | null> => {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return buildErrorResponse('App Help rate limiting is unavailable.', 503);
  }
  const clientIp = getForwardedClientIp(request);
  if (!clientIp) {
    return buildErrorResponse('App Help could not verify this request for rate limiting.', 503);
  }

  let ipHash: string;
  try {
    ipHash = await hashAppHelpClientIp(clientIp);
  } catch (error) {
    return buildErrorResponse(error instanceof Error ? error.message : 'App Help rate limiting is unavailable.', 503);
  }

  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const { data, error } = await supabaseAdmin.rpc('claim_app_help_request', { p_ip_hash: ipHash });
  if (error) {
    return buildErrorResponse('App Help rate limiting is unavailable.', 503);
  }
  const row = (Array.isArray(data) ? data[0] : data) as AppHelpRateLimitRow | null;
  if (!row || typeof row.allowed !== 'boolean') {
    return buildErrorResponse('App Help rate limiting is unavailable.', 503);
  }
  if (row.allowed) {
    return null;
  }
  const message = row.reason === 'global_limit'
    ? 'App Help has reached its daily AI limit. Common help questions still work for free.'
    : 'You have reached today\'s AI-assisted App Help limit. Common help questions still work for free.';
  return buildErrorResponse(message, 429);
};

const parsePositiveWei = (value: string): bigint | null => {
  if (!/^\d+$/.test(value)) {
    return null;
  }
  try {
    const parsed = BigInt(value);
    return parsed > 0n ? parsed : null;
  } catch {
    return null;
  }
};

const parsePositiveNumber = (value: unknown): number | null => {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const resolveOpenAiPricing = () => {
  const inputOverride = parsePositiveNumber(OPENAI_INPUT_USD_PER_1M);
  const outputOverride = parsePositiveNumber(OPENAI_OUTPUT_USD_PER_1M);
  if (inputOverride && outputOverride) {
    return { input: inputOverride, output: outputOverride };
  }
  return MODEL_PRICING_USD_PER_1M.get(OPENAI_MODEL) ?? MODEL_PRICING_USD_PER_1M.get('gpt-4.1-mini')!;
};

const estimateInputTokens = (prompt: string, contextText: string): number =>
  Math.max(1_000, Math.ceil((prompt.length + contextText.length) / 4) + 500);

const fetchWispUsdPrice = async (): Promise<number> => {
  const response = await fetch(CARBON_WISP_USD_RATE_URL);
  const body = await response.json().catch(() => null) as { data?: { USD?: unknown } } | null;
  if (!response.ok) {
    throw new Error('WISP price quote is unavailable.');
  }
  const price = parsePositiveNumber(body?.data?.USD);
  if (!price) {
    throw new Error('WISP price quote is unavailable.');
  }
  return price;
};

const normalizeTokenSymbol = (value: unknown): string =>
  normalizeString(value).toLowerCase().replace(/^p\.?/u, '').replace(/[^a-z0-9.]/gu, '');

const resolveUniswapToken = (value: unknown) => UNISWAP_TOKENS.get(normalizeTokenSymbol(value)) ?? null;

const readNestedRecord = (value: unknown, key: string): Record<string, unknown> | null => {
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : null;
  const nested = record?.[key];
  return nested && typeof nested === 'object' ? nested as Record<string, unknown> : null;
};

const formatReferencePrice = (value: number): string => {
  if (!Number.isFinite(value) || value <= 0) {
    return '';
  }
  return value.toLocaleString('en-US', {
    maximumFractionDigits: value >= 1 ? 4 : 6,
    minimumFractionDigits: 0,
    useGrouping: false
  }).replace(/(\.\d*?[1-9])0+$/u, '$1').replace(/\.0+$/u, '');
};

const parseFirstPrice = (value: unknown): number | null => {
  const numeric = parsePositiveNumber(value);
  if (numeric) {
    return numeric;
  }
  const match = normalizeString(value).match(/\d+(?:\.\d+)?/u);
  return match ? parsePositiveNumber(match[0]) : null;
};

const sourceLine = (name: string, label?: unknown, fallback?: string): string => {
  const text = normalizeString(label) || fallback || 'unavailable';
  return `${name}: ${text.replace(/^Carbon price\s+/iu, '').replace(/^Uniswap quote\s+/iu, '')}.`;
};

const buildFindPriceAnswer = (context: unknown): string => {
  const record = context && typeof context === 'object' ? context as Record<string, unknown> : {};
  const swap = readNestedRecord(record, 'swap');
  const carbonReference = readNestedRecord(swap, 'carbonReference');
  const uniswapReference = readNestedRecord(swap, 'uniswapReference');
  const bestOrder = readNestedRecord(swap, 'bestOrder');
  const requestedAmount = readNestedRecord(swap, 'requestedAmount');
  if (!swap) {
    return '';
  }

  const chainwhisperLabel = normalizeString(swap.chainwhisperPrice);
  const hasChainwhisperOrder = Boolean(bestOrder) && Boolean(chainwhisperLabel) && chainwhisperLabel !== '--';
  const sources = [
    { name: 'ChainWhisper', label: hasChainwhisperOrder ? chainwhisperLabel : 'no order' },
    { name: 'Carbon', label: carbonReference?.label },
    {
      name: 'Uniswap',
      label: normalizeString(uniswapReference?.label) || normalizeString(uniswapReference?.reason) || 'unavailable'
    }
  ];
  const orderId = parseFirstPrice(bestOrder?.id);
  const reviewLine = orderId ? ` Review ChainWhisper order #${orderId}.` : '';
  const createLine = !orderId ? ' No ChainWhisper order found. Use Draft limit order to create one.' : '';
  const hasRequestedAmount = Boolean(normalizeString(requestedAmount?.amount));
  const liquidityLine = hasRequestedAmount
    ? bestOrder?.rankingEligible === true
      ? 'The ChainWhisper order covers the requested amount using visible liquidity; external venues remain separate references.'
      : 'No ChainWhisper order was verified to cover the requested amount; external venues remain separate references.'
    : 'Price references only; no liquidity ranking or best-execution claim was made.';
  return [
    sourceLine('ChainWhisper', sources[0].label),
    sourceLine('Carbon', sources[1].label),
    sourceLine('Uniswap', sources[2].label),
    reviewLine.trim(),
    createLine.trim(),
    liquidityLine
  ].filter(Boolean).join(' ');
};

const fetchUniswapReference = async (context: unknown) => {
  const selectedPair = readNestedRecord(context, 'selectedPair');
  const swap = readNestedRecord(context, 'swap');
  const carbonReference = readNestedRecord(swap, 'carbonReference');
  const mode = normalizeString(selectedPair?.mode) === 'sell' ? 'sell' : 'buy';
  const sellToken = readNestedRecord(selectedPair, 'sellToken');
  const buyToken = readNestedRecord(selectedPair, 'buyToken');
  const base = resolveUniswapToken(mode === 'sell' ? sellToken?.symbol : buyToken?.symbol);
  const quote = resolveUniswapToken(mode === 'sell' ? buyToken?.symbol : sellToken?.symbol);

  if (!base || !quote || base.address.toLowerCase() === quote.address.toLowerCase()) {
    return { status: 'unavailable', reason: 'Uniswap reference is unavailable for this pair.' };
  }
  if (!UNISWAP_API_KEY) {
    return { status: 'unavailable', reason: 'Uniswap API key is not configured.' };
  }

  try {
    const response = await fetch('https://trade-api.gateway.uniswap.org/v1/quote', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': UNISWAP_API_KEY,
        'x-universal-router-version': '2.0'
      },
      body: JSON.stringify({
        amount: (10n ** BigInt(base.decimals)).toString(),
        routingPreference: 'BEST_PRICE',
        slippageTolerance: 0.5,
        swapper: FEE_RECIPIENT,
        tokenIn: base.address,
        tokenInChainId: 1,
        tokenOut: quote.address,
        tokenOutChainId: 1,
        type: 'EXACT_INPUT'
      })
    });
    const body = await response.json().catch(() => null) as { quote?: { output?: { amount?: unknown } } } | null;
    const outputAmount = parsePositiveWei(normalizeString(body?.quote?.output?.amount));
    if (!response.ok || !outputAmount) {
      return { status: 'unavailable', reason: 'Uniswap quote is unavailable for this pair.' };
    }
    const price = Number(outputAmount) / 10 ** quote.decimals;
    const basisLabel = normalizeString(carbonReference?.basisLabel) || `${quote.symbol}/${base.symbol}`;
    return {
      basisLabel,
      label: `Uniswap quote ${formatReferencePrice(price)} ${basisLabel}`,
      price,
      source: 'uniswap',
      status: 'ready',
      usedPublicCounterpart: true
    };
  } catch {
    return { status: 'unavailable', reason: 'Uniswap quote is unavailable for this pair.' };
  }
};

const buildAgentContext = async (context: unknown) => {
  const record = context && typeof context === 'object' ? context as Record<string, unknown> : {};
  const swap = readNestedRecord(record, 'swap');
  if (!swap) {
    return record;
  }
  return {
    ...record,
    swap: {
      ...swap,
      uniswapReference: await fetchUniswapReference(record)
    }
  };
};

const buildFeeQuote = async (prompt: string, contextText: string) => {
  const pricing = resolveOpenAiPricing();
  const inputTokens = estimateInputTokens(prompt, contextText);
  const outputTokens = Math.max(1, Number.isFinite(ESTIMATED_RESPONSE_TOKENS) ? ESTIMATED_RESPONSE_TOKENS : 500);
  const rawApiCostUsd = (inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000;
  const marginMultiplier = 1 + Math.max(0, Number.isFinite(FEE_MARGIN_BPS) ? FEE_MARGIN_BPS : 15000) / 10_000;
  const estimatedUsdFee = Math.max(MIN_FEE_USD > 0 ? MIN_FEE_USD : 0, rawApiCostUsd * marginMultiplier);
  const wispUsdPrice = await fetchWispUsdPrice();
  const wholeWispFee = Math.ceil(estimatedUsdFee / wispUsdPrice);
  if (!Number.isSafeInteger(wholeWispFee) || wholeWispFee <= 0) {
    throw new Error('Trade Agent WISP fee could not be calculated.');
  }
  const feeAmountWei = BigInt(wholeWispFee) * 10n ** BigInt(FEE_TOKEN_DECIMALS);
  return {
    estimatedInputTokens: inputTokens,
    estimatedOutputTokens: outputTokens,
    estimatedUsdFee,
    feeAmountWei,
    quoteSource: 'carbon-market-rate',
    wispUsdPrice
  };
};

const normalizeAction = (value: unknown): TradeAgentAction | null => {
  const action = normalizeString(value);
  return ACTION_TYPES.has(action) ? action as TradeAgentAction : null;
};

const readJson = async (request: Request): Promise<Record<string, unknown>> => {
  try {
    const parsed = await request.json();
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
};

const rpcCall = async <T>(method: string, params: unknown[]): Promise<T | null> => {
  if (!COTI_RPC_URL) {
    throw new Error('COTI RPC is not configured.');
  }
  const response = await fetch(COTI_RPC_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
  });
  const body = await response.json().catch(() => null) as { error?: { message?: string }; result?: T } | null;
  if (!response.ok || body?.error) {
    throw new Error(body?.error?.message || 'COTI RPC request failed.');
  }
  return body?.result ?? null;
};

const verifyPaymentReceipt = async ({
  quote,
  paymentTxHash
}: {
  quote: TradeAgentQuotePayload;
  paymentTxHash: string;
}): Promise<void> => {
  const chainId = await rpcCall<string>('eth_chainId', []);
  if ((chainId ?? '').toLowerCase() !== COTI_CHAIN_ID_HEX) {
    throw new Error('Payment RPC is not connected to COTI mainnet.');
  }

  const receipt = await rpcCall<TradeAgentReceipt>('eth_getTransactionReceipt', [paymentTxHash]);
  if (!receipt || !/^0x[a-fA-F0-9]+$/u.test(receipt.blockNumber ?? '')) {
    throw new Error('WISP payment transaction is not confirmed.');
  }
  const block = await rpcCall<{ timestamp?: string }>('eth_getBlockByNumber', [receipt.blockNumber, false]);
  let transactionBlockTimestampSeconds = 0;
  try {
    transactionBlockTimestampSeconds = Number(BigInt(block?.timestamp ?? ''));
  } catch {
    throw new Error('WISP payment block timestamp is unavailable.');
  }
  verifyTradeAgentPaymentReceiptData({
    expiresAt: quote.expiresAt,
    feeAmountWei: BigInt(quote.feeAmountWei),
    feeRecipient: quote.feeRecipient,
    feeTokenAddress: quote.feeTokenAddress,
    issuedAt: quote.issuedAt,
    payerAddress: quote.payerAddress,
    receipt,
    transactionBlockTimestampSeconds,
    transferTopic: TRANSFER_TOPIC
  });
};

const extractOutputText = (body: Record<string, unknown>): string => {
  const outputText = body.output_text;
  if (typeof outputText === 'string' && outputText.trim()) {
    return outputText;
  }
  const output = Array.isArray(body.output) ? body.output : [];
  for (const item of output) {
    if (item && typeof item === 'object' && typeof (item as { text?: unknown }).text === 'string') {
      const text = (item as { text: string }).text.trim();
      if (text) {
        return text;
      }
    }
    const content = item && typeof item === 'object' && Array.isArray((item as { content?: unknown }).content)
      ? (item as { content: unknown[] }).content
      : [];
    for (const part of content) {
      if (part && typeof part === 'object' && typeof (part as { text?: unknown }).text === 'string') {
        const text = (part as { text: string }).text.trim();
        if (text) {
          return text;
        }
      }
      if (part && typeof part === 'object' && typeof (part as { output_text?: unknown }).output_text === 'string') {
        const text = (part as { output_text: string }).output_text.trim();
        if (text) {
          return text;
        }
      }
      if (part && typeof part === 'object' && (part as { parsed?: unknown }).parsed) {
        return JSON.stringify((part as { parsed: unknown }).parsed);
      }
    }
  }
  return '';
};

const callAppHelpOpenAI = async ({
  currentPath,
  question,
  topics
}: {
  currentPath: string;
  question: string;
  topics: AppHelpTopic[];
}): Promise<{ answer: string; relatedTopicIds: string[]; supported: boolean; topicId: string }> => {
  if (!OPENAI_API_KEY) {
    throw new Error('OpenAI API key is not configured.');
  }
  const topicIds = topics.map((topic) => topic.id);
  const systemPrompt = [
    'You are ChainWhisper App Help.',
    'Answer only from the supplied ChainWhisper help topics; do not use outside knowledge or invent behavior.',
    'If the supplied topics do not support the question, set supported to false.',
    'Be direct. Use at most three short sentences and 45 words.',
    'Do not provide financial advice, create links, request secrets, or claim you can sign or execute actions.',
    'Return the most relevant supplied topic id and only supplied related topic ids.'
  ].join(' ');
  const userContent = JSON.stringify({
    currentPath,
    question,
    topics: topics.map((topic) => ({
      answer: topic.answer,
      cautions: topic.cautions,
      id: topic.id,
      prerequisites: topic.prerequisites,
      steps: topic.steps,
      summary: topic.summary,
      title: topic.title
    }))
  });
  const estimatedInputTokens = Math.ceil((systemPrompt.length + userContent.length) / 4) + 50;
  if (estimatedInputTokens > APP_HELP_MAX_INPUT_TOKENS) {
    return {
      answer: APP_HELP_UNSUPPORTED_ANSWER,
      relatedTopicIds: topicIds.slice(1),
      supported: false,
      topicId: topicIds[0]
    };
  }

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${OPENAI_API_KEY}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model: APP_HELP_MODEL,
      store: false,
      max_output_tokens: APP_HELP_MAX_OUTPUT_TOKENS,
      reasoning: { effort: 'low' },
      input: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent }
      ],
      text: {
        verbosity: 'low',
        format: {
          type: 'json_schema',
          name: 'chainwhisper_app_help_response',
          strict: true,
          schema: {
            type: 'object',
            additionalProperties: false,
            required: ['answer', 'topicId', 'relatedTopicIds', 'supported'],
            properties: {
              answer: { type: 'string' },
              topicId: { type: 'string', enum: topicIds },
              relatedTopicIds: {
                type: 'array',
                maxItems: 3,
                items: { type: 'string', enum: topicIds }
              },
              supported: { type: 'boolean' }
            }
          }
        }
      }
    })
  });

  const body = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok || !body) {
    throw new Error('App Help model request failed.');
  }
  const output = extractOutputText(body);
  if (!output) {
    throw new Error('App Help model returned an empty response.');
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(output) as Record<string, unknown>;
  } catch {
    throw new Error('App Help model returned an invalid response.');
  }
  const supported = parsed.supported === true;
  const parsedTopicId = normalizeString(parsed.topicId);
  const topicId = topicIds.includes(parsedTopicId) ? parsedTopicId : topicIds[0];
  const relatedTopicIds = Array.isArray(parsed.relatedTopicIds)
    ? parsed.relatedTopicIds
        .map(normalizeString)
        .filter((id, index, items) => topicIds.includes(id) && id !== topicId && items.indexOf(id) === index)
        .slice(0, 3)
    : [];
  const answer = normalizeString(parsed.answer);
  return {
    answer: supported && answer ? answer.slice(0, 2_000) : APP_HELP_UNSUPPORTED_ANSWER,
    relatedTopicIds,
    supported: supported && Boolean(answer),
    topicId
  };
};

const handleAppHelpRequest = async (request: Request, body: Record<string, unknown>): Promise<Response> => {
  const rawQuestion = normalizeString(body.question);
  if (!rawQuestion) {
    return buildErrorResponse('App Help question is empty.');
  }
  if (rawQuestion.length > APP_HELP_MAX_QUESTION_CHARS) {
    return buildErrorResponse(`Keep App Help questions under ${APP_HELP_MAX_QUESTION_CHARS} characters.`);
  }
  if (
    containsSensitiveAppHelpMaterial(rawQuestion) ||
    findProhibitedTradeAgentMaterial(rawQuestion) ||
    findDisallowedTradeAgentContextMaterial({ prompt: rawQuestion })
  ) {
    return jsonResponse(
      { answer: APP_HELP_SECRET_ANSWER, relatedTopicIds: [], source: 'refusal', topicId: null },
      { headers: corsHeaders }
    );
  }
  const question = redactTradeAgentSecretText(rawQuestion);
  const currentPath = getAppHelpSurfacePath(body.surface);
  const previousTopic = getAppHelpTopic(body.previousTopicId);
  const localAnswer = resolveLocalAppHelpAnswer(question, currentPath);
  if (localAnswer) {
    return jsonResponse(
      {
        answer: localAnswer.answer,
        relatedTopicIds: localAnswer.relatedTopicIds,
        source: 'local',
        topicId: localAnswer.topicId
      },
      { headers: corsHeaders }
    );
  }

  const match = matchAppHelpTopics(question, currentPath);
  if (!match.topic || match.confidence === 'none') {
    return jsonResponse(
      { answer: APP_HELP_OFF_TOPIC_ANSWER, relatedTopicIds: [], source: 'refusal', topicId: null },
      { headers: corsHeaders }
    );
  }

  const rateLimitResponse = await claimAppHelpQuota(request);
  if (rateLimitResponse) {
    return rateLimitResponse;
  }
  const topics = [match.topic, ...match.relatedTopics, previousTopic]
    .filter((topic): topic is AppHelpTopic => Boolean(topic))
    .filter((topic, index, items) => items.findIndex((item) => item.id === topic.id) === index)
    .slice(0, 3);
  try {
    const response = await callAppHelpOpenAI({ currentPath, question, topics });
    return jsonResponse(buildAppHelpAiResult(response), { headers: corsHeaders });
  } catch {
    return buildErrorResponse('App Help is unavailable right now. Common help questions still work for free.', 503);
  }
};

const callOpenAI = async ({
  action,
  context,
  prompt
}: {
  action: TradeAgentAction;
  context: unknown;
  prompt: string;
}): Promise<{ response: Record<string, unknown>; usage: Record<string, unknown> }> => {
  if (!OPENAI_API_KEY) {
    throw new Error('OpenAI API key is not configured.');
  }

  const systemPrompt = [
    'You are ChainWhisper Trade Agent.',
    'Compare current prices by chain, pair, side, display basis, and freshness; an amount is optional for a price-only comparison.',
    'Use a supplied amount only when context explicitly marks visible liquidity and executability as verified for that exact amount.',
    'Only then may you describe that source as executable for the amount; never infer or claim best liquidity.',
    'Present Carbon, Uniswap, and other reference-only or different-chain data separately and never call one best, better, or worse.',
    'Keep answer text short and precise: maximum two short sentences, no filler, no generic reminders when an action card already exists.',
    'When required draft details, comparison pair, or comparison side are missing, ask one concise follow-up question and return no action. Never require an amount for a price-only comparison.',
    'Treat context.conversation as the recent conversation. Preserve explicit terms from earlier turns and ask only for details that remain unresolved.',
    'For recurring drafts, X/Y means base token X and quote token Y. buyLiquidity is the quote-token budget and sellLiquidity is the base-token inventory.',
    'For a recurring price spread around a supplied market reference, the buy price is the lower price and the sell price is the higher price in the supplied quote/base basis.',
    'When context.recurringDraft.calculatedPrices is supplied, copy those exact buyPrice and sellPrice values into the recurring draft; do not recalculate them.',
    'Draft Limit, Recurring, counter, selected-chat trade, or message actions only when every required term is explicit.',
    'For review_orders and open_order actions, use only an exact tradeId and escrowContract pair supplied in context.',
    'For Direct drafts, never invent or return a recipient; the user selects it locally.',
    'Never return labels, access secrets, wallet addresses, private links, or hidden liquidity values.',
    'Never execute, sign, submit, send, or promise an action. The user must review every draft.',
    'Never provide financial advice or tell the user to buy or sell.',
    'Return concise JSON only.'
  ].join(' ');

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60_000);
  let response: Response;
  try {
    response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${OPENAI_API_KEY}`,
        'content-type': 'application/json'
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: OPENAI_MODEL,
        store: false,
        max_output_tokens: 4096,
        reasoning: { effort: 'low' },
        input: [
          { role: 'system', content: systemPrompt },
          {
            role: 'user',
            content: JSON.stringify({
              action,
              context,
              prompt
            })
          }
        ],
        text: {
          verbosity: 'low',
          format: {
            type: 'json_schema',
            name: 'chainwhisper_trade_agent_response',
            strict: true,
            schema: TRADE_AGENT_RESPONSE_JSON_SCHEMA
          }
        }
      })
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('Trade Agent provider timed out.');
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }

  const body = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok || !body) {
    const message =
      body && typeof body.error === 'object' && typeof (body.error as { message?: unknown }).message === 'string'
        ? (body.error as { message: string }).message
        : 'OpenAI request failed.';
    throw new Error(message);
  }

  const output = extractOutputText(body);
  if (!output) {
    const incompleteDetails = body.incomplete_details && typeof body.incomplete_details === 'object'
      ? body.incomplete_details as { reason?: unknown }
      : null;
    if (body.status === 'incomplete' && typeof incompleteDetails?.reason === 'string') {
      throw new Error(`OpenAI response was incomplete: ${incompleteDetails.reason}.`);
    }
    throw new Error('OpenAI returned an empty Trade Agent response.');
  }

  let parsedResponse: Record<string, unknown>;
  try {
    parsedResponse = JSON.parse(output) as Record<string, unknown>;
  } catch {
    throw new Error('OpenAI returned an invalid Trade Agent response.');
  }

  return {
    response: normalizeSafeTradeAgentResponse(parsedResponse, context),
    usage: body.usage && typeof body.usage === 'object' ? body.usage as Record<string, unknown> : {}
  };
};

type TradeAgentDatabase = {
  public: {
    CompositeTypes: Record<string, never>;
    Enums: Record<string, never>;
    Functions: Record<string, never>;
    Tables: {
      trade_agent_payments: {
        Insert: Record<string, unknown>;
        Relationships: [];
        Row: TradeAgentPaymentRow;
        Update: Record<string, unknown>;
      };
    };
    Views: Record<string, never>;
  };
};

type SupabaseAdminClient = ReturnType<typeof createClient<TradeAgentDatabase>>;

const PAYMENT_SELECT = [
  'action_type',
  'completed_at',
  'fee_amount_wei',
  'fee_recipient',
  'fee_token_address',
  'id',
  'payer_address',
  'payment_tx_hash',
  'quote_expires_at',
  'quote_issued_at',
  'request_hash',
  'request_id',
  'response_expires_at',
  'response_json',
  'status',
  'updated_at'
].join(',');

const buildFeeResponse = (quotedFee: Awaited<ReturnType<typeof buildFeeQuote>>) => ({
  estimatedInputTokens: quotedFee.estimatedInputTokens,
  estimatedOutputTokens: quotedFee.estimatedOutputTokens,
  estimatedUsdFee: quotedFee.estimatedUsdFee,
  feeAmountWei: quotedFee.feeAmountWei.toString(),
  feeRecipient: FEE_RECIPIENT,
  feeTokenAddress: FEE_TOKEN_ADDRESS,
  feeTokenDecimals: FEE_TOKEN_DECIMALS,
  feeTokenSymbol: 'WISP' as const,
  quoteSource: quotedFee.quoteSource,
  wispUsdPrice: quotedFee.wispUsdPrice
});

const hasTrustedOrderIdentity = (value: unknown): boolean => {
  if (Array.isArray(value)) {
    return value.some(hasTrustedOrderIdentity);
  }
  if (!value || typeof value !== 'object') {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (
    typeof record.tradeId === 'number' &&
    Number.isSafeInteger(record.tradeId) &&
    record.tradeId > 0 &&
    isAddress(normalizeString(record.escrowContract))
  ) {
    return true;
  }
  return Object.values(record).some(hasTrustedOrderIdentity);
};

const validateTradeAgentInput = ({
  action,
  body,
  requireComplete
}: {
  action: TradeAgentAction;
  body: Record<string, unknown>;
  requireComplete: boolean;
}): { context: unknown; contextText: string; prompt: string } => {
  const rawPrompt = normalizeString(body.prompt);
  const rawContext = body.context ?? {};
  const prohibited = findProhibitedTradeAgentMaterial({ context: rawContext, prompt: rawPrompt });
  if (prohibited) {
    throw new Error('Remove wallet secrets and private order links before using Trade Agent.');
  }
  if (findDisallowedTradeAgentContextMaterial({ context: rawContext, prompt: rawPrompt })) {
    throw new Error('Remove wallet addresses, balances, receipts, history, and private progress before using Trade Agent.');
  }
  if (rawPrompt.length > MAX_PROMPT_CHARS) {
    throw new Error('Prompt is too long.');
  }
  if (requireComplete && !rawPrompt) {
    throw new Error('Prompt is empty.');
  }
  if (requireComplete && hasUnresolvedTradeAgentPlaceholders(rawPrompt)) {
    throw new Error('Complete every bracketed placeholder before requesting a paid Agent quote.');
  }
  const context = redactTradeAgentSecrets(rawContext);
  const prompt = redactTradeAgentSecretText(rawPrompt);
  const contextText = JSON.stringify(context);
  if (contextText.length > MAX_CONTEXT_CHARS) {
    throw new Error('Trade Agent context is too large.');
  }
  if (
    requireComplete &&
    (action === 'explain_order' || action === 'draft_counter') &&
    !hasTrustedOrderIdentity(context)
  ) {
    throw new Error('Load a trusted order before using this Agent action.');
  }
  if (requireComplete && action === 'review_orders') {
    const orders = context && typeof context === 'object'
      ? (context as { orders?: unknown }).orders
      : null;
    if (!Array.isArray(orders) || orders.length === 0 || orders.length > 20) {
      throw new Error('Review orders requires between 1 and 20 safe order summaries.');
    }
  }
  if (requireComplete && action === 'chat_to_trade') {
    const selectedMessage = context && typeof context === 'object'
      ? (context as { selectedMessage?: unknown }).selectedMessage
      : null;
    if (!selectedMessage || typeof selectedMessage !== 'object') {
      throw new Error('Select one chat message before asking the Agent to draft a trade.');
    }
  }
  if (requireComplete) {
    const semanticError = getSemanticTradeAgentPreflightError({ action, context, prompt });
    if (semanticError) {
      throw new Error(semanticError);
    }
  }
  return { context, contextText, prompt };
};

const getPaymentByRequestId = async (
  supabaseAdmin: SupabaseAdminClient,
  requestId: string
): Promise<TradeAgentPaymentRow | null> => {
  const { data, error } = await supabaseAdmin
    .from('trade_agent_payments')
    .select(PAYMENT_SELECT)
    .eq('request_id', requestId)
    .maybeSingle();
  if (error) {
    throw new Error(error.message || 'Failed to read Trade Agent payment.');
  }
  return data as TradeAgentPaymentRow | null;
};

const getPaymentByTransaction = async (
  supabaseAdmin: SupabaseAdminClient,
  paymentTxHash: string
): Promise<TradeAgentPaymentRow | null> => {
  const { data, error } = await supabaseAdmin
    .from('trade_agent_payments')
    .select(PAYMENT_SELECT)
    .eq('payment_tx_hash', paymentTxHash)
    .maybeSingle();
  if (error) {
    throw new Error(error.message || 'Failed to read Trade Agent payment.');
  }
  return data as TradeAgentPaymentRow | null;
};

const assertPaymentMatchesQuote = (
  payment: TradeAgentPaymentRow,
  quote: TradeAgentQuotePayload,
  paymentTxHash: string
): void => {
  if (
    payment.request_id !== quote.requestId ||
    payment.request_hash !== quote.requestHash ||
    payment.action_type !== quote.action ||
    normalizeAddress(payment.payer_address ?? '') !== quote.payerAddress ||
    normalizeAddress(payment.fee_token_address ?? '') !== quote.feeTokenAddress ||
    normalizeAddress(payment.fee_recipient ?? '') !== quote.feeRecipient ||
    payment.fee_amount_wei !== quote.feeAmountWei ||
    normalizeString(payment.payment_tx_hash).toLowerCase() !== paymentTxHash
  ) {
    throw new Error('This WISP payment is bound to a different Agent request.');
  }
};

const getCompletedPaymentResponse = (
  payment: TradeAgentPaymentRow,
  now = Date.now()
): Record<string, unknown> => {
  const expiresAt = Date.parse(payment.response_expires_at ?? '');
  if (!payment.response_json || !Number.isFinite(expiresAt) || expiresAt <= now) {
    throw new Error('The cached Trade Agent response has expired.');
  }
  if (typeof payment.response_json !== 'object' || Array.isArray(payment.response_json)) {
    throw new Error('The cached Trade Agent response is unavailable.');
  }
  return payment.response_json as Record<string, unknown>;
};

const buildPaymentStateResponse = (
  payment: TradeAgentPaymentRow,
  requestId: string,
  now = Date.now(),
  allowRetryClaim = false
): Response | null => {
  if (payment.status === 'completed') {
    try {
      return jsonResponse(
        { requestId, status: 'completed', response: getCompletedPaymentResponse(payment, now) },
        { headers: corsHeaders }
      );
    } catch (error) {
      return buildErrorResponse(
        error instanceof Error ? error.message : 'The cached Trade Agent response is unavailable.',
        410
      );
    }
  }
  if (payment.status === 'failed') {
    return allowRetryClaim
      ? null
      : jsonResponse({ requestId, status: 'retryable' }, { headers: corsHeaders });
  }
  if (payment.status === 'pending') {
    const updatedAt = Date.parse(payment.updated_at ?? '');
    const leaseRemaining = Number.isFinite(updatedAt)
      ? updatedAt + TRADE_AGENT_PENDING_LEASE_MS - now
      : 0;
    if (leaseRemaining > 0) {
      return jsonResponse(
        { requestId, status: 'processing', retryAfterMs: Math.max(1_000, Math.ceil(leaseRemaining)) },
        { status: 202, headers: corsHeaders }
      );
    }
    return null;
  }
  throw new Error('Trade Agent payment status is invalid.');
};

const claimExistingPayment = async (
  supabaseAdmin: SupabaseAdminClient,
  payment: TradeAgentPaymentRow,
  nowIso: string
): Promise<TradeAgentPaymentRow | null> => {
  if (!payment.id) {
    return null;
  }
  let query = supabaseAdmin
    .from('trade_agent_payments')
    .update({
      completed_at: null,
      error_message: null,
      response_expires_at: null,
      response_json: null,
      status: 'pending',
      updated_at: nowIso
    })
    .eq('id', payment.id);
  if (payment.status === 'failed') {
    query = query.eq('status', 'failed');
  } else {
    query = query
      .eq('status', 'pending')
      .lte('updated_at', new Date(Date.parse(nowIso) - TRADE_AGENT_PENDING_LEASE_MS).toISOString());
  }
  const { data, error } = await query.select(PAYMENT_SELECT).maybeSingle();
  if (error) {
    throw new Error(error.message || 'Failed to reserve Trade Agent payment.');
  }
  return data as TradeAgentPaymentRow | null;
};

const classifyAgentFailure = (error: unknown): string => {
  const message = error instanceof Error ? error.message.toLowerCase() : '';
  if (message.includes('timed out')) {
    return 'provider_timeout';
  }
  if (message.includes('invalid') || message.includes('empty') || message.includes('incomplete')) {
    return 'invalid_provider_response';
  }
  return 'provider_error';
};

const processClaimedPayment = async ({
  action,
  context,
  payment,
  prompt,
  requestId,
  supabaseAdmin
}: {
  action: TradeAgentAction;
  context: unknown;
  payment: TradeAgentPaymentRow;
  prompt: string;
  requestId: string;
  supabaseAdmin: SupabaseAdminClient;
}): Promise<Response> => {
  if (!payment.id) {
    return buildErrorResponse('Trade Agent payment reservation is invalid.', 500);
  }
  const paymentId = payment.id;
  try {
    const builtContext = await buildAgentContext(context);
    const agentContext = {
      ...(builtContext && typeof builtContext === 'object'
        ? builtContext as Record<string, unknown>
        : {}),
      requestTokens: getKnownTradeAgentPromptTokens(prompt).map((reference) => ({ reference }))
    };
    const deterministicAnswer = action === 'find_price' ? buildFindPriceAnswer(agentContext) : '';
    const { response, usage } = deterministicAnswer
      ? {
          response: normalizeSafeTradeAgentResponse(
            { answer: deterministicAnswer, warnings: [], actions: [] },
            agentContext
          ),
          usage: {}
        }
      : await callOpenAI({ action, context: agentContext, prompt });
    const completedAt = new Date();
    const { data, error } = await supabaseAdmin
      .from('trade_agent_payments')
      .update({
        completed_at: completedAt.toISOString(),
        error_message: null,
        input_tokens: typeof usage.input_tokens === 'number' ? usage.input_tokens : null,
        model: deterministicAnswer ? 'deterministic-price-reference-v2' : OPENAI_MODEL,
        output_tokens: typeof usage.output_tokens === 'number' ? usage.output_tokens : null,
        response_expires_at: new Date(completedAt.getTime() + TRADE_AGENT_RESPONSE_TTL_MS).toISOString(),
        response_json: response,
        status: 'completed',
        total_tokens: typeof usage.total_tokens === 'number' ? usage.total_tokens : null,
        updated_at: completedAt.toISOString()
      })
      .eq('id', paymentId)
      .eq('status', 'pending')
      .select('id')
      .maybeSingle();
    if (error || !data) {
      return buildErrorResponse('Trade Agent response could not be stored for recovery.', 503);
    }
    return jsonResponse({ requestId, status: 'completed', response }, { headers: corsHeaders });
  } catch (error) {
    await supabaseAdmin
      .from('trade_agent_payments')
      .update({
        completed_at: null,
        error_message: classifyAgentFailure(error),
        response_expires_at: null,
        response_json: null,
        status: 'failed',
        updated_at: new Date().toISOString()
      })
      .eq('id', paymentId)
      .eq('status', 'pending');
    return jsonResponse({ requestId, status: 'retryable' }, { headers: corsHeaders });
  }
};

const handleTradeAgentEstimate = async (
  action: TradeAgentAction,
  body: Record<string, unknown>
): Promise<Response> => {
  let input;
  try {
    input = validateTradeAgentInput({ action, body, requireComplete: false });
    const fee = await buildFeeQuote(input.prompt, input.contextText);
    return jsonResponse(buildFeeResponse(fee), { headers: corsHeaders });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Trade Agent fee estimate is unavailable.';
    return buildErrorResponse(message, message.toLowerCase().includes('unavailable') ? 503 : 400);
  }
};

const handleTradeAgentQuote = async (
  action: TradeAgentAction,
  body: Record<string, unknown>
): Promise<Response> => {
  if (TRADE_AGENT_QUOTE_SECRET.length < 32) {
    return buildErrorResponse('Trade Agent quote signing is unavailable.', 503);
  }
  const payerAddress = normalizeAddress(normalizeString(body.payerAddress));
  if (!isAddress(payerAddress)) {
    return buildErrorResponse('Payer address is invalid.');
  }
  try {
    const input = validateTradeAgentInput({ action, body, requireComplete: true });
    const fee = await buildFeeQuote(input.prompt, input.contextText);
    const issuedAtDate = new Date();
    const quote: TradeAgentQuotePayload = {
      action,
      chainId: COTI_CHAIN_ID,
      domain: TRADE_AGENT_PROTOCOL,
      expiresAt: new Date(issuedAtDate.getTime() + TRADE_AGENT_QUOTE_TTL_MS).toISOString(),
      feeAmountWei: fee.feeAmountWei.toString(),
      feeRecipient: normalizeAddress(FEE_RECIPIENT),
      feeTokenAddress: normalizeAddress(FEE_TOKEN_ADDRESS),
      issuedAt: issuedAtDate.toISOString(),
      payerAddress,
      requestHash: await hashTradeAgentRequest({
        action,
        context: input.context,
        prompt: input.prompt
      }),
      requestId: crypto.randomUUID(),
      version: TRADE_AGENT_PROTOCOL_VERSION
    };
    return jsonResponse(
      {
        ...buildFeeResponse(fee),
        requestId: quote.requestId,
        requestHash: quote.requestHash,
        quoteToken: await createTradeAgentQuoteToken(quote, TRADE_AGENT_QUOTE_SECRET),
        authorizationMessage: buildTradeAgentAuthorizationMessage(quote),
        issuedAt: quote.issuedAt,
        expiresAt: quote.expiresAt
      },
      { headers: corsHeaders }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Trade Agent quote is unavailable.';
    return buildErrorResponse(message, message.toLowerCase().includes('unavailable') ? 503 : 400);
  }
};

const handleTradeAgentRecovery = async (body: Record<string, unknown>): Promise<Response> => {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return buildErrorResponse('Supabase function secrets are unavailable.', 500);
  }
  const requestId = normalizeString(body.requestId).toLowerCase();
  const payerAddress = normalizeAddress(normalizeString(body.payerAddress));
  const signedAt = normalizeString(body.signedAt);
  const signature = normalizeString(body.signature);
  if (!isRequestId(requestId) || !isAddress(payerAddress)) {
    return buildErrorResponse('Trade Agent recovery request is invalid.');
  }
  try {
    assertFreshTradeAgentRecoverySignature(signedAt);
    const message = buildTradeAgentRecoveryMessage({ payerAddress, requestId, signedAt });
    const signer = await recoverTradeAgentMessageSigner({ message, signature });
    if (signer !== payerAddress) {
      return buildErrorResponse('Recovery signature does not match the payment wallet.', 403);
    }
    const supabaseAdmin = createClient<TradeAgentDatabase>(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false }
    });
    const payment = await getPaymentByRequestId(supabaseAdmin, requestId);
    if (!payment || normalizeAddress(payment.payer_address ?? '') !== payerAddress) {
      return buildErrorResponse('Trade Agent payment was not found.', 404);
    }
    const stateResponse = buildPaymentStateResponse(payment, requestId);
    return stateResponse ??
      jsonResponse({ requestId, status: 'retryable' }, { headers: corsHeaders });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Trade Agent recovery failed.';
    return buildErrorResponse(message, message.includes('expired') ? 410 : 400);
  }
};

const handleTradeAgentRun = async (
  action: TradeAgentAction,
  body: Record<string, unknown>
): Promise<Response> => {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return buildErrorResponse('Supabase function secrets are unavailable.', 500);
  }
  if (TRADE_AGENT_QUOTE_SECRET.length < 32) {
    return buildErrorResponse('Trade Agent quote signing is unavailable.', 503);
  }
  const quoteToken = normalizeString(body.quoteToken);
  const payerSignature = normalizeString(body.payerSignature);
  const paymentTxHash = normalizeString(body.paymentTxHash).toLowerCase();
  if (!quoteToken || quoteToken.length > 4_096 || !payerSignature || !isHexHash(paymentTxHash)) {
    return buildErrorResponse('Trade Agent payment authorization is incomplete.');
  }

  let input: ReturnType<typeof validateTradeAgentInput>;
  let quote: TradeAgentQuotePayload;
  try {
    input = validateTradeAgentInput({ action, body, requireComplete: true });
    quote = await verifyTradeAgentQuoteToken(quoteToken, TRADE_AGENT_QUOTE_SECRET);
    const requestHash = await hashTradeAgentRequest({
      action,
      context: input.context,
      prompt: input.prompt
    });
    if (
      quote.action !== action ||
      quote.requestHash !== requestHash ||
      quote.feeTokenAddress !== normalizeAddress(FEE_TOKEN_ADDRESS) ||
      quote.feeRecipient !== normalizeAddress(FEE_RECIPIENT) ||
      (normalizeString(body.requestId) && normalizeString(body.requestId).toLowerCase() !== quote.requestId) ||
      (normalizeString(body.requestHash) && normalizeString(body.requestHash).toLowerCase() !== quote.requestHash)
    ) {
      return buildErrorResponse('Trade Agent request does not match its signed quote.', 409);
    }
    const payerAddress = normalizeAddress(normalizeString(body.payerAddress));
    if (payerAddress !== quote.payerAddress) {
      return buildErrorResponse('Trade Agent quote belongs to another wallet.', 403);
    }
    const authorizationMessage = buildTradeAgentAuthorizationMessage(quote);
    const signer = await recoverTradeAgentMessageSigner({
      message: authorizationMessage,
      signature: payerSignature
    });
    if (signer !== quote.payerAddress) {
      return buildErrorResponse('Payment authorization signature does not match the payer.', 403);
    }
  } catch (error) {
    return buildErrorResponse(error instanceof Error ? error.message : 'Trade Agent authorization is invalid.');
  }

  const supabaseAdmin = createClient<TradeAgentDatabase>(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false }
  });
  try {
    const [paymentByRequest, paymentByTransaction] = await Promise.all([
      getPaymentByRequestId(supabaseAdmin, quote.requestId),
      getPaymentByTransaction(supabaseAdmin, paymentTxHash)
    ]);
    if (paymentByRequest && paymentByTransaction && paymentByRequest.id !== paymentByTransaction.id) {
      return buildErrorResponse('This WISP payment is bound to another Agent request.', 409);
    }
    let payment = paymentByRequest ?? paymentByTransaction;
    if (payment) {
      try {
        assertPaymentMatchesQuote(payment, quote, paymentTxHash);
      } catch {
        return buildErrorResponse('This WISP payment is bound to a different Agent request.', 409);
      }
      const stateResponse = buildPaymentStateResponse(payment, quote.requestId, Date.now(), true);
      if (stateResponse) {
        return stateResponse;
      }
      try {
        await verifyPaymentReceipt({ quote, paymentTxHash });
      } catch (error) {
        return buildErrorResponse(error instanceof Error ? error.message : 'Payment verification failed.', 402);
      }
      const claimed = await claimExistingPayment(supabaseAdmin, payment, new Date().toISOString());
      if (!claimed) {
        payment = await getPaymentByRequestId(supabaseAdmin, quote.requestId);
        if (!payment) {
          return buildErrorResponse('Trade Agent payment reservation was lost.', 503);
        }
        return buildPaymentStateResponse(payment, quote.requestId, Date.now(), true) ??
          jsonResponse(
            { requestId: quote.requestId, status: 'processing', retryAfterMs: 2_000 },
            { status: 202, headers: corsHeaders }
          );
      }
      payment = claimed;
    } else {
      try {
        await verifyPaymentReceipt({ quote, paymentTxHash });
      } catch (error) {
        return buildErrorResponse(error instanceof Error ? error.message : 'Payment verification failed.', 402);
      }
      const nowIso = new Date().toISOString();
      const { data, error } = await supabaseAdmin
        .from('trade_agent_payments')
        .insert({
          action_type: action,
          error_message: null,
          fee_amount_wei: quote.feeAmountWei,
          fee_recipient: quote.feeRecipient,
          fee_token_address: quote.feeTokenAddress,
          payer_address: quote.payerAddress,
          payment_tx_hash: paymentTxHash,
          quote_expires_at: quote.expiresAt,
          quote_issued_at: quote.issuedAt,
          request_hash: quote.requestHash,
          request_id: quote.requestId,
          status: 'pending',
          updated_at: nowIso
        })
        .select(PAYMENT_SELECT)
        .single();
      if (error || !data) {
        const racedPayment =
          await getPaymentByRequestId(supabaseAdmin, quote.requestId) ??
          await getPaymentByTransaction(supabaseAdmin, paymentTxHash);
        if (!racedPayment) {
          return buildErrorResponse(error?.message || 'Failed to reserve Trade Agent payment.', 500);
        }
        try {
          assertPaymentMatchesQuote(racedPayment, quote, paymentTxHash);
        } catch {
          return buildErrorResponse('This WISP payment is bound to another Agent request.', 409);
        }
        return buildPaymentStateResponse(racedPayment, quote.requestId) ??
          jsonResponse(
            { requestId: quote.requestId, status: 'processing', retryAfterMs: 2_000 },
            { status: 202, headers: corsHeaders }
          );
      }
      payment = data as TradeAgentPaymentRow;
    }

    return processClaimedPayment({
      action,
      context: input.context,
      payment,
      prompt: input.prompt,
      requestId: quote.requestId,
      supabaseAdmin
    });
  } catch (error) {
    return buildErrorResponse(error instanceof Error ? error.message : 'Trade Agent payment failed.', 500);
  }
};

export const handleTradeAgentHttpRequest = async (request: Request): Promise<Response> => {
  const corsResponse = handleCorsPreflight(request);
  if (corsResponse) {
    return corsResponse;
  }

  if (request.method !== 'POST') {
    return buildErrorResponse('Method not allowed.', 405);
  }

  const body = await readJson(request);
  if (body.kind === 'help') {
    return handleAppHelpRequest(request, body);
  }
  if (body.kind === 'recover') {
    return handleTradeAgentRecovery(body);
  }
  const action = normalizeAction(body.action);
  if (!action) {
    return buildErrorResponse('Trade Agent action is not supported.');
  }
  if (body.kind === 'estimate') {
    return handleTradeAgentEstimate(action, body);
  }
  if (body.kind === 'quote') {
    return handleTradeAgentQuote(action, body);
  }
  if (body.kind === 'run') {
    return handleTradeAgentRun(action, body);
  }
  return buildErrorResponse('Trade Agent request kind is not supported.');
};

if (import.meta.main) {
  Deno.serve(handleTradeAgentHttpRequest);
}
