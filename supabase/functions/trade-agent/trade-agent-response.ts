import { findProhibitedTradeAgentMaterial } from './trade-agent-safety.ts';

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/u;
const POSITIVE_DECIMAL_RE = /^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/u;
const TOKEN_KEYS = new Set([
  'reference',
  'symbol',
  'sellToken',
  'buyToken',
  'baseToken',
  'quoteToken',
  'offerToken',
  'requestToken'
]);

type TrustedOrder = {
  escrowContract: string;
  tradeId: number;
};

const normalizeString = (value: unknown, maxLength = 300): string =>
  typeof value === 'string' ? value.trim().slice(0, maxLength) : '';

const normalizeAddress = (value: unknown): string => {
  const address = normalizeString(value, 42);
  return ADDRESS_RE.test(address) ? address.toLowerCase() : '';
};

const normalizePositiveDecimal = (value: unknown): string => {
  const decimal = normalizeString(value, 80);
  if (!POSITIVE_DECIMAL_RE.test(decimal)) {
    return '';
  }
  try {
    const [whole, fraction = ''] = decimal.split('.');
    return BigInt(`${whole}${fraction}`) > 0n ? decimal : '';
  } catch {
    return '';
  }
};

const collectTrustedValues = (
  value: unknown,
  tokens: Map<string, string>,
  orders: Map<string, TrustedOrder>
): void => {
  if (Array.isArray(value)) {
    value.forEach((nested) => collectTrustedValues(nested, tokens, orders));
    return;
  }
  if (!value || typeof value !== 'object') {
    return;
  }
  const record = value as Record<string, unknown>;
  for (const [key, nested] of Object.entries(record)) {
    if (TOKEN_KEYS.has(key) && typeof nested === 'string') {
      const token = normalizeString(nested, 80);
      if (token) {
        tokens.set(token.toLowerCase(), token);
      }
    }
    collectTrustedValues(nested, tokens, orders);
  }
  const tradeId = record.tradeId;
  const escrowContract = normalizeAddress(record.escrowContract);
  if (typeof tradeId === 'number' && Number.isSafeInteger(tradeId) && tradeId > 0 && escrowContract) {
    orders.set(`${tradeId}:${escrowContract}`, { escrowContract, tradeId });
  }
};

const normalizeTrustedToken = (value: unknown, knownTokens: Map<string, string>): string => {
  const candidate = normalizeString(value, 80);
  return candidate ? knownTokens.get(candidate.toLowerCase()) ?? '' : '';
};

const normalizeTrustedOrder = (
  tradeIdValue: unknown,
  escrowContractValue: unknown,
  trustedOrders: Map<string, TrustedOrder>
): TrustedOrder | null => {
  if (typeof tradeIdValue !== 'number' || !Number.isSafeInteger(tradeIdValue) || tradeIdValue <= 0) {
    return null;
  }
  const escrowContract = normalizeAddress(escrowContractValue);
  return trustedOrders.get(`${tradeIdValue}:${escrowContract}`) ?? null;
};

const normalizeAction = (
  value: unknown,
  knownTokens: Map<string, string>,
  trustedOrders: Map<string, TrustedOrder>
): Record<string, unknown> | null => {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const action = value as Record<string, unknown>;
  if (findProhibitedTradeAgentMaterial(action)) {
    return null;
  }
  const type = normalizeString(action.type, 40);
  if (type === 'prefill_message') {
    const message = normalizeString(action.message, 500);
    return message ? { type, message } : null;
  }
  if (type === 'open_order') {
    const order = normalizeTrustedOrder(action.tradeId, action.escrowContract, trustedOrders);
    return order ? { type, ...order } : null;
  }
  if (type === 'prefill_swap') {
    const inputMode = action.inputMode === 'sell' || action.inputMode === 'buy' ? action.inputMode : '';
    const sellToken = normalizeTrustedToken(action.sellToken, knownTokens);
    const buyToken = normalizeTrustedToken(action.buyToken, knownTokens);
    const sellAmount = normalizePositiveDecimal(action.sellAmount);
    const buyAmount = normalizePositiveDecimal(action.buyAmount);
    if (!inputMode || !sellToken || !buyToken || sellToken === buyToken || (!sellAmount && !buyAmount)) {
      return null;
    }
    return {
      type,
      inputMode,
      sellToken,
      buyToken,
      ...(sellAmount ? { sellAmount } : {}),
      ...(buyAmount ? { buyAmount } : {})
    };
  }
  if (type === 'prefill_limit') {
    const sellToken = normalizeTrustedToken(action.sellToken, knownTokens);
    const buyToken = normalizeTrustedToken(action.buyToken, knownTokens);
    const sellAmount = normalizePositiveDecimal(action.sellAmount);
    const buyAmount = normalizePositiveDecimal(action.buyAmount);
    const price = normalizePositiveDecimal(action.price);
    const accessType = ['public', 'unlisted', 'direct'].includes(String(action.accessType))
      ? String(action.accessType)
      : '';
    const amountVisibility = ['visible', 'private-hidden'].includes(String(action.amountVisibility))
      ? String(action.amountVisibility)
      : '';
    if (
      !sellToken ||
      !buyToken ||
      sellToken === buyToken ||
      !sellAmount ||
      !buyAmount ||
      !price ||
      !accessType ||
      !amountVisibility
    ) {
      return null;
    }
    return {
      type,
      sellToken,
      buyToken,
      sellAmount,
      buyAmount,
      price,
      accessType,
      amountVisibility
    };
  }
  if (type === 'prefill_recurring') {
    const baseToken = normalizeTrustedToken(action.baseToken, knownTokens);
    const quoteToken = normalizeTrustedToken(action.quoteToken, knownTokens);
    const buyPrice = normalizePositiveDecimal(action.buyPrice);
    const sellPrice = normalizePositiveDecimal(action.sellPrice);
    const buyLiquidity = normalizePositiveDecimal(action.buyLiquidity);
    const sellLiquidity = normalizePositiveDecimal(action.sellLiquidity);
    const amountVisibility = ['visible', 'private-hidden'].includes(String(action.amountVisibility))
      ? String(action.amountVisibility)
      : '';
    if (
      !baseToken ||
      !quoteToken ||
      baseToken === quoteToken ||
      !buyPrice ||
      !sellPrice ||
      !buyLiquidity ||
      !sellLiquidity ||
      !amountVisibility
    ) {
      return null;
    }
    return {
      type,
      baseToken,
      quoteToken,
      buyPrice,
      sellPrice,
      buyLiquidity,
      sellLiquidity,
      amountVisibility
    };
  }
  if (type === 'prefill_counter') {
    const order = normalizeTrustedOrder(action.tradeId, action.escrowContract, trustedOrders);
    const sellToken = normalizeTrustedToken(action.sellToken, knownTokens);
    const buyToken = normalizeTrustedToken(action.buyToken, knownTokens);
    const sellAmount = normalizePositiveDecimal(action.sellAmount);
    const buyAmount = normalizePositiveDecimal(action.buyAmount);
    const message = normalizeString(action.message, 500);
    if (!order || !sellToken || !buyToken || sellToken === buyToken || !sellAmount || !buyAmount) {
      return null;
    }
    return {
      type,
      ...order,
      sellToken,
      buyToken,
      sellAmount,
      buyAmount,
      ...(message ? { message } : {})
    };
  }
  return null;
};

export const normalizeSafeTradeAgentResponse = (value: unknown, context: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object') {
    throw new Error('Trade Agent returned an invalid response.');
  }
  const record = value as Record<string, unknown>;
  const answer = normalizeString(record.answer, 2_000);
  if (!answer) {
    throw new Error('Trade Agent response was empty.');
  }
  const knownTokens = new Map<string, string>();
  const trustedOrders = new Map<string, TrustedOrder>();
  collectTrustedValues(context, knownTokens, trustedOrders);
  const warnings = Array.isArray(record.warnings)
    ? record.warnings.map((warning) => normalizeString(warning, 500)).filter(Boolean).slice(0, 4)
    : [];
  if (findProhibitedTradeAgentMaterial({ answer, warnings })) {
    throw new Error('Trade Agent response contained unsafe material.');
  }
  const actions = Array.isArray(record.actions)
    ? record.actions
        .map((action) => normalizeAction(action, knownTokens, trustedOrders))
        .filter((action): action is Record<string, unknown> => Boolean(action))
        .slice(0, 5)
    : [];
  return { answer, warnings, actions };
};

const stringProperty = { type: 'string' } as const;

export const TRADE_AGENT_RESPONSE_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['answer', 'warnings', 'actions'],
  properties: {
    answer: stringProperty,
    warnings: {
      type: 'array',
      maxItems: 4,
      items: stringProperty
    },
    actions: {
      type: 'array',
      maxItems: 5,
      items: {
        anyOf: [
          {
            type: 'object',
            additionalProperties: false,
            required: ['type', 'inputMode', 'sellToken', 'buyToken', 'sellAmount', 'buyAmount'],
            properties: {
              type: { type: 'string', enum: ['prefill_swap'] },
              inputMode: { type: 'string', enum: ['sell', 'buy'] },
              sellToken: stringProperty,
              buyToken: stringProperty,
              sellAmount: { type: ['string', 'null'] },
              buyAmount: { type: ['string', 'null'] }
            }
          },
          {
            type: 'object',
            additionalProperties: false,
            required: [
              'type',
              'sellToken',
              'buyToken',
              'sellAmount',
              'buyAmount',
              'price',
              'accessType',
              'amountVisibility'
            ],
            properties: {
              type: { type: 'string', enum: ['prefill_limit'] },
              sellToken: stringProperty,
              buyToken: stringProperty,
              sellAmount: stringProperty,
              buyAmount: stringProperty,
              price: stringProperty,
              accessType: { type: 'string', enum: ['public', 'unlisted', 'direct'] },
              amountVisibility: { type: 'string', enum: ['visible', 'private-hidden'] }
            }
          },
          {
            type: 'object',
            additionalProperties: false,
            required: [
              'type',
              'baseToken',
              'quoteToken',
              'buyPrice',
              'sellPrice',
              'buyLiquidity',
              'sellLiquidity',
              'amountVisibility'
            ],
            properties: {
              type: { type: 'string', enum: ['prefill_recurring'] },
              baseToken: stringProperty,
              quoteToken: stringProperty,
              buyPrice: stringProperty,
              sellPrice: stringProperty,
              buyLiquidity: stringProperty,
              sellLiquidity: stringProperty,
              amountVisibility: { type: 'string', enum: ['visible', 'private-hidden'] }
            }
          },
          {
            type: 'object',
            additionalProperties: false,
            required: [
              'type',
              'tradeId',
              'escrowContract',
              'sellToken',
              'buyToken',
              'sellAmount',
              'buyAmount',
              'message'
            ],
            properties: {
              type: { type: 'string', enum: ['prefill_counter'] },
              tradeId: { type: 'integer' },
              escrowContract: stringProperty,
              sellToken: stringProperty,
              buyToken: stringProperty,
              sellAmount: stringProperty,
              buyAmount: stringProperty,
              message: { type: ['string', 'null'] }
            }
          },
          {
            type: 'object',
            additionalProperties: false,
            required: ['type', 'message'],
            properties: {
              type: { type: 'string', enum: ['prefill_message'] },
              message: stringProperty
            }
          },
          {
            type: 'object',
            additionalProperties: false,
            required: ['type', 'tradeId', 'escrowContract'],
            properties: {
              type: { type: 'string', enum: ['open_order'] },
              tradeId: { type: 'integer' },
              escrowContract: stringProperty
            }
          }
        ]
      }
    }
  }
} as const;
