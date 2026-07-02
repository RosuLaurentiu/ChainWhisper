import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders, handleCorsPreflight } from '../_shared/cors.ts';
import { jsonResponse } from '../_shared/chat-image.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY') ?? '';
const OPENAI_MODEL = Deno.env.get('OPENAI_MODEL') ?? 'gpt-5-mini';
const UNISWAP_API_KEY = Deno.env.get('UNISWAP_API_KEY') ?? '';
const COTI_RPC_URL = Deno.env.get('COTI_RPC_URL') ?? '';

const COTI_CHAIN_ID_HEX = '0x282b34';
const FEE_TOKEN_ADDRESS = '0xb70c55bd0823436F44877DC6A9f46E0C55f2C3A8';
const FEE_RECIPIENT = '0xbf01185A70CDfEF1858659836D57BFf085ebed55';
const FEE_TOKEN_DECIMALS = 6;
const CARBON_WISP_USD_RATE_URL =
  Deno.env.get('CARBON_WISP_USD_RATE_URL') ??
  `https://api.carbondefi.xyz/v1/coti/market-rate?address=${FEE_TOKEN_ADDRESS}&convert=USD`;
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const MAX_PROMPT_CHARS = 4_000;
const MAX_CONTEXT_CHARS = 14_000;
const ESTIMATED_RESPONSE_TOKENS = Number(Deno.env.get('TRADE_AGENT_ESTIMATED_RESPONSE_TOKENS') ?? '500');
const FEE_MARGIN_BPS = Number(Deno.env.get('TRADE_AGENT_FEE_MARGIN_BPS') ?? '15000');
const MIN_FEE_USD = Number(Deno.env.get('TRADE_AGENT_MIN_FEE_USD') ?? '0.006');
const OPENAI_INPUT_USD_PER_1M = Deno.env.get('TRADE_AGENT_OPENAI_INPUT_USD_PER_1M');
const OPENAI_OUTPUT_USD_PER_1M = Deno.env.get('TRADE_AGENT_OPENAI_OUTPUT_USD_PER_1M');
const ACTION_TYPES = new Set(['explain_order', 'find_price', 'draft_counter', 'draft_limit', 'chat_to_trade']);
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

type TradeAgentAction = 'explain_order' | 'find_price' | 'draft_counter' | 'draft_limit' | 'chat_to_trade';

type RpcReceipt = {
  logs?: Array<{
    address?: string;
    data?: string;
    topics?: string[];
  }>;
  status?: string;
};

const buildErrorResponse = (message: string, status = 400): Response =>
  jsonResponse({ error: message }, { status, headers: corsHeaders });

const normalizeString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');
const isHexHash = (value: string): boolean => /^0x[a-fA-F0-9]{64}$/.test(value);
const isAddress = (value: string): boolean => /^0x[a-fA-F0-9]{40}$/.test(value);
const isRequestId = (value: string): boolean =>
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(value);
const normalizeAddress = (value: string): string => value.trim().toLowerCase();
const topicForAddress = (address: string): string => `0x${normalizeAddress(address).replace(/^0x/, '').padStart(64, '0')}`;

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
  const selectedPair = readNestedRecord(record, 'selectedPair');
  const swap = readNestedRecord(record, 'swap');
  const carbonReference = readNestedRecord(swap, 'carbonReference');
  const uniswapReference = readNestedRecord(swap, 'uniswapReference');
  const bestOrder = readNestedRecord(swap, 'bestOrder');
  if (!swap) {
    return '';
  }

  const mode = normalizeString(selectedPair?.mode) === 'sell' ? 'sell' : 'buy';
  const chainwhisperLabel = normalizeString(swap.chainwhisperPrice);
  const hasChainwhisperOrder = Boolean(bestOrder) && Boolean(chainwhisperLabel) && chainwhisperLabel !== '--';
  const sources = [
    { name: 'ChainWhisper', price: parseFirstPrice(chainwhisperLabel), label: hasChainwhisperOrder ? chainwhisperLabel : 'no order' },
    { name: 'Carbon', price: parseFirstPrice(carbonReference?.label), label: carbonReference?.label },
    {
      name: 'Uniswap',
      price: parseFirstPrice(uniswapReference?.label),
      label: normalizeString(uniswapReference?.label) || normalizeString(uniswapReference?.reason) || 'unavailable'
    }
  ];
  const priced = sources.filter((source) => source.price !== null) as Array<
    typeof sources[number] & { price: number }
  >;
  const best = priced.length
    ? priced.reduce((winner, source) => mode === 'buy'
      ? (source.price < winner.price ? source : winner)
      : (source.price > winner.price ? source : winner))
    : null;
  const orderId = parseFirstPrice(bestOrder?.id);
  const reviewLine = orderId ? ` Review ChainWhisper order #${orderId}.` : '';
  const createLine = !orderId ? ' No ChainWhisper order found. Use Draft trade to create a limit order.' : '';
  const bestLine = best ? ` Best market price: ${best.name}.` : '';
  return [
    sourceLine('ChainWhisper', sources[0].label),
    sourceLine('Carbon', sources[1].label),
    sourceLine('Uniswap', sources[2].label),
    bestLine.trim(),
    reviewLine.trim(),
    createLine.trim()
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
  const feeUnits = Math.ceil((estimatedUsdFee / wispUsdPrice) * 10 ** FEE_TOKEN_DECIMALS);
  if (!Number.isSafeInteger(feeUnits) || feeUnits <= 0) {
    throw new Error('Trade Agent WISP fee could not be calculated.');
  }
  return {
    estimatedInputTokens: inputTokens,
    estimatedOutputTokens: outputTokens,
    estimatedUsdFee,
    feeAmountWei: BigInt(feeUnits),
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
  feeAmountWei,
  payerAddress,
  paymentTxHash
}: {
  feeAmountWei: bigint;
  payerAddress: string;
  paymentTxHash: string;
}): Promise<void> => {
  const chainId = await rpcCall<string>('eth_chainId', []);
  if ((chainId ?? '').toLowerCase() !== COTI_CHAIN_ID_HEX) {
    throw new Error('Payment RPC is not connected to COTI mainnet.');
  }

  const receipt = await rpcCall<RpcReceipt>('eth_getTransactionReceipt', [paymentTxHash]);
  if (!receipt || receipt.status?.toLowerCase() !== '0x1') {
    throw new Error('WISP payment transaction is not confirmed.');
  }

  const payerTopic = topicForAddress(payerAddress);
  const recipientTopic = topicForAddress(FEE_RECIPIENT);
  const validTransfer = (receipt.logs ?? []).some((log) => {
    const topics = log.topics ?? [];
    if (
      normalizeAddress(log.address ?? '') !== normalizeAddress(FEE_TOKEN_ADDRESS) ||
      topics[0]?.toLowerCase() !== TRANSFER_TOPIC ||
      topics[1]?.toLowerCase() !== payerTopic ||
      topics[2]?.toLowerCase() !== recipientTopic
    ) {
      return false;
    }
    try {
      return BigInt(log.data ?? '0x0') >= feeAmountWei;
    } catch {
      return false;
    }
  });

  if (!validTransfer) {
    throw new Error('Payment transaction did not include the required WISP transfer.');
  }
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
    'Help users compare the best single ChainWhisper order with Carbon and Uniswap when available, draft concise negotiation replies, and draft/prefill trade forms.',
    'For find_price requests, use the supplied ChainWhisper, Carbon, and Uniswap context together instead of treating them as separate tasks.',
    'For price favorability, obey the selected side: if the user is buying the displayed base token, lower quote/base is better; if the user is selling the displayed base token, higher quote/base is better.',
    'If the context lacks enough numeric data to compare favorability, state both prices without saying better, worse, or best value.',
    'Keep answer text short and precise: maximum two short sentences, no filler, no generic reminders when an action card already exists.',
    'For draft trade requests, return a prefill action only when side, tokens, amount, and price are clear enough; otherwise ask one short clarifying question and return no actions.',
    'Never say should buy, should sell, better value, or financial advice; say review the order instead. Never promise private liquidity, never execute or sign transactions, and use one best ChainWhisper order only.',
    'Hidden intents, solver actions, and private-fee pWISP billing are not available in V1.',
    'Return concise JSON only.'
  ].join(' ');

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${OPENAI_API_KEY}`,
      'content-type': 'application/json'
    },
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
          schema: {
            type: 'object',
            additionalProperties: false,
            required: ['answer', 'warnings', 'actions'],
            properties: {
              answer: { type: 'string' },
              warnings: {
                type: 'array',
                items: { type: 'string' }
              },
              actions: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  required: ['type', 'label', 'inputMode', 'sellToken', 'buyToken', 'sellAmount', 'buyAmount', 'price', 'message', 'tradeId', 'accessSecret', 'escrowContract'],
                  properties: {
                    type: {
                      type: 'string',
                      enum: ['prefill_swap', 'prefill_limit', 'prefill_counter', 'prefill_message', 'open_order']
                    },
                    label: { type: ['string', 'null'] },
                    inputMode: { type: ['string', 'null'], enum: ['sell', 'buy', null] },
                    sellToken: { type: ['string', 'null'] },
                    buyToken: { type: ['string', 'null'] },
                    sellAmount: { type: ['string', 'null'] },
                    buyAmount: { type: ['string', 'null'] },
                    price: { type: ['string', 'null'] },
                    message: { type: ['string', 'null'] },
                    tradeId: { type: ['number', 'null'] },
                    accessSecret: { type: ['string', 'null'] },
                    escrowContract: { type: ['string', 'null'] }
                  }
                }
              }
            }
          }
        }
      }
    })
  });

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
    response: parsedResponse,
    usage: body.usage && typeof body.usage === 'object' ? body.usage as Record<string, unknown> : {}
  };
};

Deno.serve(async (request) => {
  const corsResponse = handleCorsPreflight(request);
  if (corsResponse) {
    return corsResponse;
  }

  if (request.method !== 'POST') {
    return buildErrorResponse('Method not allowed.', 405);
  }

  const body = await readJson(request);
  const action = normalizeAction(body.action);
  if (!action) {
    return buildErrorResponse('Trade Agent action is not supported.');
  }

  const prompt = normalizeString(body.prompt);
  const contextText = JSON.stringify(body.context ?? {});
  if (prompt.length > MAX_PROMPT_CHARS) {
    return buildErrorResponse('Prompt is too long.');
  }
  if (contextText.length > MAX_CONTEXT_CHARS) {
    return buildErrorResponse('Trade Agent context is too large.');
  }

  let quotedFee;
  try {
    quotedFee = await buildFeeQuote(prompt, contextText);
  } catch (error) {
    return buildErrorResponse(error instanceof Error ? error.message : 'Trade Agent fee quote is unavailable.', 503);
  }

  if (body.kind === 'quote') {
    return jsonResponse(
      {
        estimatedInputTokens: quotedFee.estimatedInputTokens,
        estimatedOutputTokens: quotedFee.estimatedOutputTokens,
        estimatedUsdFee: quotedFee.estimatedUsdFee,
        feeAmountWei: quotedFee.feeAmountWei.toString(),
        feeRecipient: FEE_RECIPIENT,
        feeTokenAddress: FEE_TOKEN_ADDRESS,
        feeTokenDecimals: FEE_TOKEN_DECIMALS,
        feeTokenSymbol: 'WISP',
        quoteSource: quotedFee.quoteSource,
        wispUsdPrice: quotedFee.wispUsdPrice
      },
      { headers: corsHeaders }
    );
  }

  if (body.kind !== 'run') {
    return buildErrorResponse('Trade Agent request kind is not supported.');
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return buildErrorResponse('Supabase function secrets are unavailable.', 500);
  }

  const payerAddress = normalizeString(body.payerAddress);
  const paymentTxHash = normalizeString(body.paymentTxHash).toLowerCase();
  const requestId = normalizeString(body.requestId);
  if (!isAddress(payerAddress)) {
    return buildErrorResponse('Payer address is invalid.');
  }
  if (!isHexHash(paymentTxHash)) {
    return buildErrorResponse('Payment transaction hash is invalid.');
  }
  if (requestId && !isRequestId(requestId)) {
    return buildErrorResponse('Trade Agent request id is invalid.');
  }
  if (!prompt || prompt.length > MAX_PROMPT_CHARS) {
    return buildErrorResponse('Prompt is empty or too long.');
  }
  if (contextText.length > MAX_CONTEXT_CHARS) {
    return buildErrorResponse('Trade Agent context is too large.');
  }

  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const { data: existingPayment, error: existingError } = await supabaseAdmin
    .from('trade_agent_payments')
    .select('fee_amount_wei,payer_address,request_id,status')
    .eq('payment_tx_hash', paymentTxHash)
    .maybeSingle();
  if (existingError) {
    return buildErrorResponse(existingError.message || 'Failed to check payment replay.', 500);
  }
  if (existingPayment) {
    if (existingPayment.status === 'completed') {
      return buildErrorResponse('This Trade Agent payment was already used.', 409);
    }
    if (existingPayment.status === 'pending') {
      return buildErrorResponse('This Trade Agent payment is already being processed.', 409);
    }
    if (existingPayment.payer_address !== normalizeAddress(payerAddress)) {
      return buildErrorResponse('This Trade Agent payment belongs to another wallet.', 409);
    }
    if (existingPayment.request_id && requestId && existingPayment.request_id !== requestId) {
      return buildErrorResponse('This Trade Agent payment belongs to another request.', 409);
    }
  }

  const retryFeeAmountWei =
    existingPayment?.status === 'failed' ? parsePositiveWei(String(existingPayment.fee_amount_wei ?? '')) : null;
  const feeAmountWei = retryFeeAmountWei ?? quotedFee.feeAmountWei;
  try {
    await verifyPaymentReceipt({ feeAmountWei, payerAddress, paymentTxHash });
  } catch (error) {
    return buildErrorResponse(error instanceof Error ? error.message : 'Payment verification failed.', 402);
  }

  const paymentRecord = {
    action_type: action,
    error_message: null,
    fee_amount_wei: feeAmountWei.toString(),
    fee_recipient: FEE_RECIPIENT,
    fee_token_address: FEE_TOKEN_ADDRESS,
    payer_address: normalizeAddress(payerAddress),
    payment_tx_hash: paymentTxHash,
    request_id: existingPayment?.request_id ?? (requestId || null),
    status: 'pending',
    updated_at: new Date().toISOString()
  };
  const { error: insertError } = existingPayment
    ? await supabaseAdmin.from('trade_agent_payments').update(paymentRecord).eq('payment_tx_hash', paymentTxHash)
    : await supabaseAdmin.from('trade_agent_payments').insert(paymentRecord);
  if (insertError) {
    return buildErrorResponse(insertError.message || 'Failed to reserve Trade Agent payment.', 500);
  }

  try {
    const agentContext = await buildAgentContext(body.context ?? {});
    const deterministicAnswer = action === 'find_price' ? buildFindPriceAnswer(agentContext) : '';
    const { response, usage } = deterministicAnswer
      ? {
          response: { answer: deterministicAnswer, warnings: [], actions: [] },
          usage: {}
        }
      : await callOpenAI({ action, context: agentContext, prompt });
    await supabaseAdmin
      .from('trade_agent_payments')
      .update({
        input_tokens: typeof usage.input_tokens === 'number' ? usage.input_tokens : null,
        model: OPENAI_MODEL,
        output_tokens: typeof usage.output_tokens === 'number' ? usage.output_tokens : null,
        status: 'completed',
        total_tokens: typeof usage.total_tokens === 'number' ? usage.total_tokens : null,
        updated_at: new Date().toISOString()
      })
      .eq('payment_tx_hash', paymentTxHash);
    return jsonResponse(response, { headers: corsHeaders });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Trade Agent failed.';
    await supabaseAdmin
      .from('trade_agent_payments')
      .update({ error_message: message.slice(0, 500), status: 'failed', updated_at: new Date().toISOString() })
      .eq('payment_tx_hash', paymentTxHash);
    return buildErrorResponse(message, 500);
  }
});
