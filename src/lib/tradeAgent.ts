import { REWARD_TOKEN_ADDRESS, isWalletAddress } from './appShared';

export const TRADE_AGENT_FEE_RECIPIENT = '0xbf01185A70CDfEF1858659836D57BFf085ebed55';
export const TRADE_AGENT_FEE_TOKEN_ADDRESS = REWARD_TOKEN_ADDRESS;
const TRADE_AGENT_DRAFT_STORAGE_KEY = 'chainwhisper:trade-agent:draft:v1';
const TRADE_AGENT_DRAFT_TTL_MS = 10 * 60 * 1000;

export type TradeAgentActionType =
  | 'explain_order'
  | 'find_price'
  | 'draft_counter'
  | 'draft_limit'
  | 'chat_to_trade';

export type TradeAgentResponseActionType =
  | 'prefill_swap'
  | 'prefill_limit'
  | 'prefill_counter'
  | 'prefill_message'
  | 'open_order';

export type TradeAgentFeeQuote = {
  estimatedInputTokens?: number;
  estimatedOutputTokens?: number;
  estimatedUsdFee?: number;
  feeAmountWei: string;
  feeRecipient: string;
  feeTokenAddress: string;
  feeTokenDecimals: number;
  feeTokenSymbol: 'WISP';
  quoteSource: string;
  wispUsdPrice?: number;
};

export type TradeAgentResponseAction = {
  type: TradeAgentResponseActionType;
  label?: string;
  inputMode?: 'sell' | 'buy';
  sellToken?: string;
  buyToken?: string;
  sellAmount?: string;
  buyAmount?: string;
  price?: string;
  message?: string;
  tradeId?: number;
  accessSecret?: string;
  escrowContract?: string;
};

export type TradeAgentResponse = {
  answer: string;
  warnings: string[];
  actions: TradeAgentResponseAction[];
};

export type TradeAgentRunInput = {
  action: TradeAgentActionType;
  context: unknown;
  payerAddress: string;
  paymentTxHash: string;
  prompt: string;
  requestId?: string;
};

export type TradeAgentDraft = {
  action: TradeAgentActionType;
  context?: unknown;
  prompt: string;
  timestamp: number;
};

export type TradeAgentQuickAction = {
  action: TradeAgentActionType;
  label: string;
  prompt: string;
  requiresContext?: boolean;
};

const normalizeTokenAlias = (value: string): string => value.trim().toLowerCase().replace(/[^a-z0-9.]/g, '');
const compactTokenAlias = (value: string): string => normalizeTokenAlias(value).replace(/[^a-z0-9]/g, '');

const buildTokenAliases = (symbol: string): string[] => {
  const normalized = normalizeTokenAlias(symbol);
  const aliases = new Set([normalized, compactTokenAlias(symbol)]);
  if (normalized.startsWith('p.')) {
    const withoutPrivatePrefix = normalized.slice(2);
    aliases.add(withoutPrivatePrefix);
    aliases.add(withoutPrivatePrefix.replace(/[^a-z0-9]/g, ''));
    if (withoutPrivatePrefix.endsWith('.e')) {
      const withoutSuffix = withoutPrivatePrefix.slice(0, -2);
      aliases.add(withoutSuffix);
      aliases.add(`p.${withoutSuffix}`);
      aliases.add(`p${withoutSuffix}`);
    }
  }
  if (normalized.endsWith('.e')) {
    aliases.add(normalized.slice(0, -2));
  }
  return [...aliases].filter(Boolean);
};

export const getTradeAgentPromptTokenMentions = (prompt: string, knownSymbols: string[]): string[] => {
  const knownAliases = new Map<string, string>();
  knownSymbols.forEach((symbol) => {
    buildTokenAliases(symbol).forEach((alias) => knownAliases.set(alias, symbol));
  });
  const mentions: string[] = [];
  prompt
    .toLowerCase()
    .split(/[^a-z0-9.]+/i)
    .flatMap((token) => [normalizeTokenAlias(token), compactTokenAlias(token)])
    .filter(Boolean)
    .forEach((token) => {
      const symbol = knownAliases.get(token);
      if (symbol && !mentions.includes(symbol)) {
        mentions.push(symbol);
      }
    });
  return mentions;
};

export const TRADE_AGENT_QUICK_ACTIONS: TradeAgentQuickAction[] = [
  {
    action: 'find_price',
    label: 'Find best price',
    prompt: 'I want to buy [amount] [token] with [token].'
  },
  {
    action: 'draft_limit',
    label: 'Draft trade',
    prompt: 'I want to [buy/sell] [amount] [token] for [token] at [price]. Order: [public/unlisted/direct]. Liquidity: [private/visible].'
  }
];

const ACTION_TYPES = new Set<TradeAgentResponseActionType>([
  'prefill_swap',
  'prefill_limit',
  'prefill_counter',
  'prefill_message',
  'open_order'
]);
const REQUEST_ACTION_TYPES = new Set<TradeAgentActionType>([
  'explain_order',
  'find_price',
  'draft_counter',
  'draft_limit',
  'chat_to_trade'
]);

const normalizeString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const normalizeAmountInput = (value: unknown): string => {
  const raw = normalizeString(value);
  return /^\d*(?:\.\d*)?$/.test(raw) ? raw : '';
};

const normalizeTradeAgentAction = (value: unknown): TradeAgentResponseAction | null => {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const record = value as Record<string, unknown>;
  const type = normalizeString(record.type) as TradeAgentResponseActionType;
  if (!ACTION_TYPES.has(type)) {
    return null;
  }
  const inputMode = normalizeString(record.inputMode);
  const action: TradeAgentResponseAction = { type };
  const label = normalizeString(record.label);
  const sellToken = normalizeString(record.sellToken);
  const buyToken = normalizeString(record.buyToken);
  const sellAmount = normalizeAmountInput(record.sellAmount);
  const buyAmount = normalizeAmountInput(record.buyAmount);
  const price = normalizeAmountInput(record.price);
  const message = normalizeString(record.message);
  const accessSecret = normalizeString(record.accessSecret);
  const escrowContract = normalizeString(record.escrowContract);
  if (label) action.label = label;
  if (inputMode === 'sell' || inputMode === 'buy') action.inputMode = inputMode;
  if (sellToken) action.sellToken = sellToken;
  if (buyToken) action.buyToken = buyToken;
  if (sellAmount) action.sellAmount = sellAmount;
  if (buyAmount) action.buyAmount = buyAmount;
  if (price) action.price = price;
  if (message) action.message = message;
  if (typeof record.tradeId === 'number' && Number.isSafeInteger(record.tradeId) && record.tradeId > 0) {
    action.tradeId = record.tradeId;
  }
  if (accessSecret) action.accessSecret = accessSecret;
  if (isWalletAddress(escrowContract)) action.escrowContract = escrowContract;
  return action;
};

export const normalizeTradeAgentResponse = (value: unknown): TradeAgentResponse => {
  if (!value || typeof value !== 'object') {
    throw new Error('Trade Agent returned an invalid response.');
  }
  const record = value as Record<string, unknown>;
  const answer = normalizeString(record.answer);
  if (!answer) {
    throw new Error('Trade Agent response was empty.');
  }
  const warnings = Array.isArray(record.warnings)
    ? record.warnings.map(normalizeString).filter(Boolean).slice(0, 4)
    : [];
  const actions = Array.isArray(record.actions)
    ? record.actions.map(normalizeTradeAgentAction).filter((action): action is TradeAgentResponseAction => Boolean(action))
    : [];
  return { answer, warnings, actions };
};

export const getTradeAgentActionButtonLabel = (action: TradeAgentResponseAction): string => {
  if (action.label) {
    return action.label;
  }
  if (action.type === 'prefill_swap') {
    return 'Prefill swap';
  }
  if (action.type === 'prefill_limit') {
    return 'Prefill limit';
  }
  if (action.type === 'prefill_counter') {
    return 'Prefill counter';
  }
  if (action.type === 'open_order') {
    return 'Open order';
  }
  if (action.type === 'prefill_message') {
    return 'Copy draft';
  }
  return 'Use draft';
};

export const canUseTradeAgentAction = (action: TradeAgentResponseAction): boolean =>
  action.type === 'prefill_swap' ||
  action.type === 'prefill_limit' ||
  action.type === 'prefill_counter' ||
  action.type === 'open_order' ||
  Boolean(action.message);

export const getTradeAgentActionDescription = (action: TradeAgentResponseAction): string => {
  if (action.type === 'prefill_swap') {
    return [action.sellAmount, action.sellToken, 'for', action.buyToken].filter(Boolean).join(' ');
  }
  if (action.type === 'prefill_limit') {
    return [action.sellToken, '->', action.buyToken, action.price ? `at ${action.price}` : ''].filter(Boolean).join(' ');
  }
  if (action.type === 'prefill_counter') {
    return [action.sellToken, '->', action.buyToken, action.price ? `at ${action.price}` : ''].filter(Boolean).join(' ');
  }
  if (action.type === 'open_order' && action.tradeId) {
    return `Order #${action.tradeId}`;
  }
  if (action.message) {
    return action.message.length > 84 ? `${action.message.slice(0, 84)}...` : action.message;
  }
  return 'Review before using.';
};

export const getTradeAgentActionCta = (action: TradeAgentResponseAction): string =>
  action.type === 'open_order' ? 'Open' : 'Use';

const invokeTradeAgentFunction = async <T>(body: Record<string, unknown>): Promise<T> => {
  const { getSupabaseBrowserClient } = await import('./supabaseClient');
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase.functions.invoke<T>('trade-agent', { body });
  if (error) {
    const response = (error as { context?: unknown }).context;
    if (response instanceof Response) {
      const payload = await response.clone().json().catch(() => null) as { error?: unknown } | null;
      const message = normalizeString(payload?.error) || await response.text().catch(() => '');
      if (message) {
        throw new Error(message);
      }
    }
    throw new Error(error.message || 'Trade Agent request failed.');
  }
  return data as T;
};

export const fetchTradeAgentFeeQuote = async (
  action: TradeAgentActionType,
  context?: unknown,
  prompt = ''
): Promise<TradeAgentFeeQuote> => {
  const quote = await invokeTradeAgentFunction<Partial<TradeAgentFeeQuote>>({ kind: 'quote', action, context, prompt });
  const feeAmountWei = normalizeString(quote.feeAmountWei);
  const feeRecipient = normalizeString(quote.feeRecipient);
  const feeTokenAddress = normalizeString(quote.feeTokenAddress);
  const feeTokenDecimals = typeof quote.feeTokenDecimals === 'number' ? quote.feeTokenDecimals : 6;
  if (!/^\d+$/.test(feeAmountWei) || !isWalletAddress(feeRecipient) || !isWalletAddress(feeTokenAddress)) {
    throw new Error('Trade Agent fee quote is unavailable.');
  }
  return {
    feeAmountWei,
    feeRecipient,
    feeTokenAddress,
    feeTokenDecimals,
    feeTokenSymbol: 'WISP',
    quoteSource: normalizeString(quote.quoteSource) || 'configured',
    ...(typeof quote.estimatedInputTokens === 'number' ? { estimatedInputTokens: quote.estimatedInputTokens } : {}),
    ...(typeof quote.estimatedOutputTokens === 'number' ? { estimatedOutputTokens: quote.estimatedOutputTokens } : {}),
    ...(typeof quote.estimatedUsdFee === 'number' ? { estimatedUsdFee: quote.estimatedUsdFee } : {}),
    ...(typeof quote.wispUsdPrice === 'number' ? { wispUsdPrice: quote.wispUsdPrice } : {})
  };
};

export const runTradeAgentRequest = async (input: TradeAgentRunInput): Promise<TradeAgentResponse> => {
  const response = await invokeTradeAgentFunction<unknown>({
    kind: 'run',
    action: input.action,
    context: input.context,
    payerAddress: input.payerAddress,
    paymentTxHash: input.paymentTxHash,
    prompt: input.prompt,
    requestId: input.requestId
  });
  return normalizeTradeAgentResponse(response);
};

export const rememberTradeAgentDraft = (
  draft: Omit<TradeAgentDraft, 'timestamp'>,
  storage: Pick<Storage, 'setItem'> | null = typeof window === 'undefined' ? null : window.sessionStorage
): void => {
  try {
    storage?.setItem(TRADE_AGENT_DRAFT_STORAGE_KEY, JSON.stringify({ ...draft, timestamp: Date.now() }));
  } catch {
  }
};

export const consumeTradeAgentDraft = (
  storage: Pick<Storage, 'getItem' | 'removeItem'> | null = typeof window === 'undefined' ? null : window.sessionStorage,
  now = Date.now()
): TradeAgentDraft | null => {
  if (!storage) {
    return null;
  }
  try {
    const raw = storage.getItem(TRADE_AGENT_DRAFT_STORAGE_KEY);
    storage.removeItem(TRADE_AGENT_DRAFT_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<TradeAgentDraft>;
    const action = parsed.action;
    const prompt = normalizeString(parsed.prompt);
    const timestamp = typeof parsed.timestamp === 'number' ? parsed.timestamp : 0;
    if (!action || !prompt || !REQUEST_ACTION_TYPES.has(action) || now - timestamp > TRADE_AGENT_DRAFT_TTL_MS) {
      return null;
    }
    return {
      action,
      context: parsed.context,
      prompt,
      timestamp
    };
  } catch {
    try {
      storage.removeItem(TRADE_AGENT_DRAFT_STORAGE_KEY);
    } catch {
    }
    return null;
  }
};
