import {
  DIRECT_TRADE_ESCROW_CONTRACT_ADDRESS,
  REWARD_TOKEN_ADDRESS,
  TRADE_ESCROW_CONTRACT_ADDRESS,
  isWalletAddress,
  type TradeAssetPayload,
  type TradeOfferMessagePayload,
  type TradeSnapshot
} from './appShared';
import { ZERO_TRADE_TAKER_ADDRESS } from './tradePerspective';

export const TRADE_AGENT_FEE_RECIPIENT = '0xbf01185A70CDfEF1858659836D57BFf085ebed55';
export const TRADE_AGENT_FEE_TOKEN_ADDRESS = REWARD_TOKEN_ADDRESS;
const TRADE_AGENT_DRAFT_STORAGE_KEY = 'chainwhisper:trade-agent:draft:v1';
const TRADE_AGENT_DRAFT_TTL_MS = 10 * 60 * 1000;

export type TradeAgentActionType =
  | 'explain_order'
  | 'find_price'
  | 'draft_counter'
  | 'draft_limit'
  | 'draft_recurring'
  | 'review_orders'
  | 'chat_to_trade';

export type TradeAgentResponseActionType =
  | 'prefill_swap'
  | 'prefill_limit'
  | 'prefill_recurring'
  | 'prefill_counter'
  | 'prefill_message'
  | 'open_order';

export type TradeAgentAccessType = 'public' | 'unlisted' | 'direct';
export type TradeAgentAmountVisibility = 'visible' | 'private-hidden';

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

export type TradeAgentPaymentQuote = TradeAgentFeeQuote & {
  authorizationMessage: string;
  expiresAt: string;
  issuedAt: string;
  quoteToken: string;
  requestHash: string;
  requestId: string;
};

export type TradeAgentPrefillSwapAction = {
  type: 'prefill_swap';
  inputMode: 'sell' | 'buy';
  sellToken: string;
  buyToken: string;
  sellAmount?: string;
  buyAmount?: string;
};

export type TradeAgentPrefillLimitAction = {
  type: 'prefill_limit';
  sellToken: string;
  buyToken: string;
  sellAmount: string;
  buyAmount: string;
  price: string;
  accessType: TradeAgentAccessType;
  amountVisibility: TradeAgentAmountVisibility;
};

export type TradeAgentPrefillRecurringAction = {
  type: 'prefill_recurring';
  baseToken: string;
  quoteToken: string;
  buyPrice: string;
  sellPrice: string;
  buyLiquidity: string;
  sellLiquidity: string;
  amountVisibility: TradeAgentAmountVisibility;
};

export type TradeAgentPrefillCounterAction = {
  type: 'prefill_counter';
  tradeId: number;
  escrowContract: string;
  sellToken: string;
  buyToken: string;
  sellAmount: string;
  buyAmount: string;
  message?: string;
};

export type TradeAgentPrefillMessageAction = {
  type: 'prefill_message';
  message: string;
};

export type TradeAgentOpenOrderAction = {
  type: 'open_order';
  tradeId: number;
  escrowContract: string;
};

export type TradeAgentResponseAction =
  | TradeAgentPrefillSwapAction
  | TradeAgentPrefillLimitAction
  | TradeAgentPrefillRecurringAction
  | TradeAgentPrefillCounterAction
  | TradeAgentPrefillMessageAction
  | TradeAgentOpenOrderAction;

export type TradeAgentKnownToken = {
  reference: string;
  aliases?: readonly string[];
  decimals?: number;
};

export type TradeAgentTrustedOrderIdentity = {
  tradeId: number;
  escrowContract: string;
};

export type TradeAgentNormalizationOptions = {
  knownTokens?: readonly TradeAgentKnownToken[];
  trustedOrders?: readonly TradeAgentTrustedOrderIdentity[];
};

export type TradeAgentResponse = {
  answer: string;
  warnings: string[];
  actions: TradeAgentResponseAction[];
};

export type TradeAgentRunInput = {
  action: TradeAgentActionType;
  context: unknown;
  normalization?: TradeAgentNormalizationOptions;
  payerAddress: string;
  payerSignature: string;
  paymentTxHash: string;
  prompt: string;
  quoteToken: string;
  requestHash: string;
  requestId: string;
};

export type TradeAgentRunResult =
  | {
      requestId: string;
      status: 'completed';
      response: TradeAgentResponse;
    }
  | {
      requestId: string;
      status: 'processing';
      retryAfterMs: number;
    }
  | {
      requestId: string;
      status: 'retryable';
    };

export type TradeAgentRecoverInput = {
  normalization?: TradeAgentNormalizationOptions;
  payerAddress: string;
  requestId: string;
  signature: string;
  signedAt: string;
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
  contextRequirement?: 'order' | 'orders';
};

const normalizeTokenAlias = (value: string): string => value.trim().toLowerCase().replace(/[^a-z0-9.]/g, '');
const compactTokenAlias = (value: string): string => normalizeTokenAlias(value).replace(/[^a-z0-9]/g, '');

const buildTokenAliases = (symbol: string): string[] => {
  const normalized = normalizeTokenAlias(symbol);
  const aliases = new Set([normalized, compactTokenAlias(symbol)]);
  if (normalized.startsWith('p.')) {
    const withoutPrivatePrefix = normalized.slice(2);
    if (withoutPrivatePrefix.endsWith('.e')) {
      const withoutSuffix = withoutPrivatePrefix.slice(0, -2);
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
    label: 'Compare price references',
    prompt: 'Compare token prices.'
  },
  {
    action: 'draft_limit',
    label: 'Draft limit order',
    prompt: 'Draft a limit order.'
  },
  {
    action: 'draft_recurring',
    label: 'Draft recurring order',
    prompt: 'Draft a recurring order.'
  },
  {
    action: 'explain_order',
    label: 'Explain this order',
    prompt: 'Explain this order.',
    contextRequirement: 'order'
  },
  {
    action: 'draft_counter',
    label: 'Draft a counter',
    prompt: 'Draft a counter for this order.',
    contextRequirement: 'order'
  },
  {
    action: 'review_orders',
    label: 'Review my orders',
    prompt: 'Review my orders.',
    contextRequirement: 'orders'
  }
];

const ACTION_TYPES = new Set<TradeAgentResponseActionType>([
  'prefill_swap',
  'prefill_limit',
  'prefill_recurring',
  'prefill_counter',
  'prefill_message',
  'open_order'
]);
const REQUEST_ACTION_TYPES = new Set<TradeAgentActionType>([
  'explain_order',
  'find_price',
  'draft_counter',
  'draft_limit',
  'draft_recurring',
  'review_orders',
  'chat_to_trade'
]);

const normalizeString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const normalizePositiveAmountInput = (value: unknown, decimals = 18): string => {
  const raw = normalizeString(value);
  if (!/^\d+(?:\.\d+)?$/.test(raw) || raw.length > 96) {
    return '';
  }
  const [, fraction = ''] = raw.split('.');
  const safeDecimals = Number.isFinite(decimals) ? Math.max(0, Math.min(36, Math.trunc(decimals))) : 18;
  if (fraction.length > safeDecimals || !/[1-9]/.test(raw)) {
    return '';
  }
  return raw;
};

const PRIVATE_LINK_PATTERN =
  /\/(?:otc\/order|trades)\/(?:link|l)\/[A-Za-z0-9_-]+|[?&#]secret=|#0x[a-fA-F0-9]{64}\b/i;
const HEX_SECRET_PATTERN = /\b0x[a-f0-9]{64}\b/i;
const LABELED_SECRET_PATTERN =
  /\b(?:private\s*key|seed\s*phrase|recovery\s*phrase|mnemonic|access\s*secret)\b\s*(?::|=|is)?\s*(?:0x[a-fA-F0-9]{64}|[a-z]+(?:\s+[a-z]+){11,23})/i;
const SECRET_KEY_PATTERN =
  /^(?:access[_ -]?secret|private[_ -]?key|mnemonic|seed[_ -]?phrase|recovery[_ -]?phrase|secret|share[_ -]?code)$/i;

export const containsTradeAgentSecretText = (value: string): boolean =>
  PRIVATE_LINK_PATTERN.test(value) ||
  HEX_SECRET_PATTERN.test(value) ||
  LABELED_SECRET_PATTERN.test(value);

const normalizeAgentMessage = (value: unknown): string => {
  const message = normalizeString(value).slice(0, 1_200);
  return message && !containsTradeAgentSecretText(message) ? message : '';
};

const findKnownToken = (
  value: unknown,
  knownTokens?: readonly TradeAgentKnownToken[]
): TradeAgentKnownToken | null => {
  const raw = normalizeString(value);
  if (!raw) {
    return null;
  }
  if (knownTokens === undefined) {
    return /^(?:0x[a-fA-F0-9]{40}|[a-zA-Z0-9][a-zA-Z0-9._-]{0,63})$/.test(raw)
      ? { reference: raw, decimals: 18 }
      : null;
  }
  const key = raw.toLowerCase();
  return knownTokens.find((token) =>
    [token.reference, ...(token.aliases ?? [])].some((alias) => alias.trim().toLowerCase() === key)
  ) ?? null;
};

const normalizeTokenPair = (
  record: Record<string, unknown>,
  firstKey: string,
  secondKey: string,
  options: TradeAgentNormalizationOptions
): { first: TradeAgentKnownToken; second: TradeAgentKnownToken } | null => {
  const first = findKnownToken(record[firstKey], options.knownTokens);
  const second = findKnownToken(record[secondKey], options.knownTokens);
  if (!first || !second || first.reference.toLowerCase() === second.reference.toLowerCase()) {
    return null;
  }
  return { first, second };
};

const normalizeTradeIdentity = (
  record: Record<string, unknown>,
  options: TradeAgentNormalizationOptions
): TradeAgentTrustedOrderIdentity | null => {
  const tradeId = record.tradeId;
  const escrowContract = normalizeString(record.escrowContract);
  if (
    typeof tradeId !== 'number' ||
    !Number.isSafeInteger(tradeId) ||
    tradeId <= 0 ||
    !isWalletAddress(escrowContract)
  ) {
    return null;
  }
  if (options.trustedOrders === undefined) {
    return { tradeId, escrowContract };
  }
  return options.trustedOrders.find(
    (order) =>
      order.tradeId === tradeId &&
      order.escrowContract.trim().toLowerCase() === escrowContract.toLowerCase()
  ) ?? null;
};

const normalizeTradeAgentAction = (
  value: unknown,
  options: TradeAgentNormalizationOptions
): TradeAgentResponseAction | null => {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const record = value as Record<string, unknown>;
  const type = normalizeString(record.type) as TradeAgentResponseActionType;
  if (!ACTION_TYPES.has(type)) {
    return null;
  }

  if (type === 'prefill_message') {
    const message = normalizeAgentMessage(record.message);
    return message ? { type, message } : null;
  }

  if (type === 'open_order') {
    const identity = normalizeTradeIdentity(record, options);
    return identity ? { type, ...identity } : null;
  }

  if (type === 'prefill_recurring') {
    const pair = normalizeTokenPair(record, 'baseToken', 'quoteToken', options);
    const amountVisibility = normalizeString(record.amountVisibility);
    if (!pair || (amountVisibility !== 'visible' && amountVisibility !== 'private-hidden')) {
      return null;
    }
    const buyPrice = normalizePositiveAmountInput(record.buyPrice);
    const sellPrice = normalizePositiveAmountInput(record.sellPrice);
    const buyLiquidity = normalizePositiveAmountInput(record.buyLiquidity, pair.second.decimals);
    const sellLiquidity = normalizePositiveAmountInput(record.sellLiquidity, pair.first.decimals);
    if (!buyPrice || !sellPrice || !buyLiquidity || !sellLiquidity) {
      return null;
    }
    return {
      type,
      baseToken: pair.first.reference,
      quoteToken: pair.second.reference,
      buyPrice,
      sellPrice,
      buyLiquidity,
      sellLiquidity,
      amountVisibility
    };
  }

  const pair = normalizeTokenPair(record, 'sellToken', 'buyToken', options);
  if (!pair) {
    return null;
  }
  const sellAmount = normalizePositiveAmountInput(record.sellAmount, pair.first.decimals);
  const buyAmount = normalizePositiveAmountInput(record.buyAmount, pair.second.decimals);

  if (type === 'prefill_swap') {
    const inputMode = normalizeString(record.inputMode);
    if (
      (inputMode !== 'sell' && inputMode !== 'buy') ||
      (inputMode === 'sell' && !sellAmount) ||
      (inputMode === 'buy' && !buyAmount)
    ) {
      return null;
    }
    return {
      type,
      inputMode,
      sellToken: pair.first.reference,
      buyToken: pair.second.reference,
      ...(sellAmount ? { sellAmount } : {}),
      ...(buyAmount ? { buyAmount } : {})
    };
  }

  if (!sellAmount || !buyAmount) {
    return null;
  }

  if (type === 'prefill_limit') {
    const price = normalizePositiveAmountInput(record.price);
    const accessType = normalizeString(record.accessType);
    const amountVisibility = normalizeString(record.amountVisibility);
    if (
      !price ||
      (accessType !== 'public' && accessType !== 'unlisted' && accessType !== 'direct') ||
      (amountVisibility !== 'visible' && amountVisibility !== 'private-hidden')
    ) {
      return null;
    }
    return {
      type,
      sellToken: pair.first.reference,
      buyToken: pair.second.reference,
      sellAmount,
      buyAmount,
      price,
      accessType,
      amountVisibility
    };
  }

  if (type === 'prefill_counter') {
    const identity = normalizeTradeIdentity(record, options);
    if (!identity) {
      return null;
    }
    const message = normalizeAgentMessage(record.message);
    return {
      type,
      ...identity,
      sellToken: pair.first.reference,
      buyToken: pair.second.reference,
      sellAmount,
      buyAmount,
      ...(message ? { message } : {})
    };
  }

  return null;
};

export const normalizeTradeAgentResponse = (
  value: unknown,
  options: TradeAgentNormalizationOptions = {}
): TradeAgentResponse => {
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
    ? record.actions
        .map((action) => normalizeTradeAgentAction(action, options))
        .filter((action): action is TradeAgentResponseAction => Boolean(action))
    : [];
  return { answer, warnings, actions };
};

export const getTradeAgentActionButtonLabel = (action: TradeAgentResponseAction): string => {
  if (action.type === 'prefill_swap') {
    return 'Prefill swap';
  }
  if (action.type === 'prefill_limit') {
    return 'Prefill limit';
  }
  if (action.type === 'prefill_recurring') {
    return 'Prefill recurring';
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
  action.type === 'prefill_recurring' ||
  action.type === 'prefill_counter' ||
  action.type === 'open_order' ||
  action.type === 'prefill_message';

export const getTradeAgentActionDescription = (action: TradeAgentResponseAction): string => {
  if (action.type === 'prefill_swap') {
    return [action.sellAmount, action.sellToken, 'for', action.buyToken].filter(Boolean).join(' ');
  }
  if (action.type === 'prefill_limit') {
    return `${action.sellAmount} ${action.sellToken} -> ${action.buyAmount} ${action.buyToken} at ${action.price}`;
  }
  if (action.type === 'prefill_recurring') {
    return `${action.baseToken}/${action.quoteToken} · buy ${action.buyPrice} · sell ${action.sellPrice}`;
  }
  if (action.type === 'prefill_counter') {
    return `${action.sellAmount} ${action.sellToken} -> ${action.buyAmount} ${action.buyToken}`;
  }
  if (action.type === 'open_order') {
    return `Order #${action.tradeId}`;
  }
  if (action.type === 'prefill_message') {
    return action.message.length > 84 ? `${action.message.slice(0, 84)}...` : action.message;
  }
  return 'Review before using.';
};

export const getTradeAgentActionCta = (action: TradeAgentResponseAction): string =>
  action.type === 'open_order' ? 'Open' : 'Use';

export type TradeAgentSafeAsset = {
  kind: TradeAssetPayload['kind'];
  symbol: string;
  decimals: number;
  amount?: string;
};

export type TradeAgentSafeOrderSummary = {
  tradeId: number;
  escrowContract: string;
  orderType: 'one-off' | 'recurring';
  status: string;
  accessType: TradeAgentAccessType;
  amountVisibility: TradeAgentAmountVisibility;
  offer?: TradeAgentSafeAsset;
  request?: TradeAgentSafeAsset;
  base?: TradeAgentSafeAsset;
  quote?: TradeAgentSafeAsset;
  buyTerms?: { baseAmount: string; quoteAmount: string };
  sellTerms?: { baseAmount: string; quoteAmount: string };
  buySideOpen?: boolean;
  sellSideOpen?: boolean;
};

const normalizeSafeIntegerAmount = (value: unknown): string => {
  const raw = normalizeString(value);
  return /^\d+$/.test(raw) && raw.length <= 96 ? raw : '';
};

const buildSafeAsset = (asset: TradeAssetPayload, includeAmount: boolean): TradeAgentSafeAsset => {
  const amount = includeAmount ? normalizeSafeIntegerAmount(asset.amount) : '';
  return {
    kind: asset.kind,
    symbol: asset.symbol.slice(0, 64),
    decimals: Number.isFinite(asset.decimals) ? Math.max(0, Math.min(36, Math.trunc(asset.decimals))) : 18,
    ...(amount ? { amount } : {})
  };
};

export const buildTradeAgentSafeOrderSummary = (
  snapshot: TradeSnapshot
): TradeAgentSafeOrderSummary | null => {
  const recurring = snapshot.recurringOrder;
  const escrowContract = snapshot.escrowContract ?? (recurring ? '' : TRADE_ESCROW_CONTRACT_ADDRESS);
  if (!isWalletAddress(escrowContract)) {
    return null;
  }

  if (recurring) {
    if (!Number.isSafeInteger(recurring.orderId) || recurring.orderId <= 0) {
      return null;
    }
    const visibleAmounts = recurring.mode === 'public';
    const buyBaseAmount = normalizeSafeIntegerAmount(recurring.buyTerms.baseAmount);
    const buyQuoteAmount = normalizeSafeIntegerAmount(recurring.buyTerms.quoteAmount);
    const sellBaseAmount = normalizeSafeIntegerAmount(recurring.sellTerms.baseAmount);
    const sellQuoteAmount = normalizeSafeIntegerAmount(recurring.sellTerms.quoteAmount);
    const recurringAccessType: TradeAgentAccessType = snapshot.isPublic
      ? 'public'
      : snapshot.taker?.trim().toLowerCase() !== ZERO_TRADE_TAKER_ADDRESS
        ? 'direct'
        : 'unlisted';
    return {
      tradeId: recurring.orderId,
      escrowContract,
      orderType: 'recurring',
      status: recurring.recurringStatus,
      accessType: recurringAccessType,
      amountVisibility: recurring.mode === 'public' ? 'visible' : 'private-hidden',
      base: buildSafeAsset(recurring.baseAsset, false),
      quote: buildSafeAsset(recurring.quoteAsset, false),
      ...(visibleAmounts && buyBaseAmount && buyQuoteAmount
        ? { buyTerms: { baseAmount: buyBaseAmount, quoteAmount: buyQuoteAmount } }
        : {}),
      ...(visibleAmounts && sellBaseAmount && sellQuoteAmount
        ? { sellTerms: { baseAmount: sellBaseAmount, quoteAmount: sellQuoteAmount } }
        : {}),
      ...(visibleAmounts
        ? {
            buySideOpen: recurring.buySideOpen,
            sellSideOpen: recurring.sellSideOpen
          }
        : {})
    };
  }

  if (!Number.isSafeInteger(snapshot.tradeId) || snapshot.tradeId <= 0) {
    return null;
  }
  const hidden = Boolean(snapshot.hiddenLiquidity);
  const accessType: TradeAgentAccessType =
    escrowContract.toLowerCase() === DIRECT_TRADE_ESCROW_CONTRACT_ADDRESS.toLowerCase()
      ? 'direct'
      : snapshot.isPublic
        ? 'public'
        : 'unlisted';
  return {
    tradeId: snapshot.tradeId,
    escrowContract,
    orderType: 'one-off',
    status: snapshot.status,
    accessType,
    amountVisibility: hidden ? 'private-hidden' : 'visible',
    offer: buildSafeAsset(snapshot.offer, !hidden),
    request: buildSafeAsset(snapshot.request, !hidden)
  };
};

export const buildTradeAgentOpenedOrderContext = (
  snapshot: TradeSnapshot | null
): TradeAgentSafeOrderSummary | null => snapshot ? buildTradeAgentSafeOrderSummary(snapshot) : null;

export const buildTradeAgentOrderReviewContext = (
  trades: readonly TradeSnapshot[]
): {
  clientSurface: 'otc-agent';
  surface: 'orders';
  orders: TradeAgentSafeOrderSummary[];
} => {
  const seen = new Set<string>();
  const orders: TradeAgentSafeOrderSummary[] = [];
  for (const trade of trades) {
    const summary = buildTradeAgentSafeOrderSummary(trade);
    if (!summary) {
      continue;
    }
    const key = `${summary.escrowContract.toLowerCase()}:${summary.tradeId}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    orders.push(summary);
    if (orders.length === 20) {
      break;
    }
  }
  return { clientSurface: 'otc-agent', surface: 'orders', orders };
};

type TradeAgentChatContextInput = {
  selectedMessage?: {
    direction: 'incoming' | 'outgoing';
    text: string;
  } | null;
  linkedTrade?: {
    tradeId: number;
    escrowContract?: string;
    previewOffer?: TradeOfferMessagePayload;
  } | null;
};

export const buildTradeAgentChatContext = ({
  selectedMessage,
  linkedTrade
}: TradeAgentChatContextInput): {
  clientSurface: 'chat';
  selectedMessage: { direction: 'incoming' | 'outgoing'; text: string } | null;
  linkedTrade: {
    tradeId: number;
    escrowContract: string;
    hiddenLiquidity: boolean;
    offer?: TradeAgentSafeAsset;
    request?: TradeAgentSafeAsset;
  } | null;
} => {
  const text = selectedMessage?.text.trim().slice(0, 2_000) ?? '';
  if (text && containsTradeAgentSecretText(text)) {
    throw new Error('Remove private keys, recovery words, access secrets, and private order links before using Trade Agent.');
  }

  const escrowContract = linkedTrade?.escrowContract ?? TRADE_ESCROW_CONTRACT_ADDRESS;
  const preview = linkedTrade?.previewOffer;
  const validLinkedTrade =
    linkedTrade &&
    Number.isSafeInteger(linkedTrade.tradeId) &&
    linkedTrade.tradeId > 0 &&
    isWalletAddress(escrowContract);
  const hiddenLiquidity = Boolean(preview?.hiddenLiquidity);
  return {
    clientSurface: 'chat',
    selectedMessage: selectedMessage && text
      ? { direction: selectedMessage.direction, text }
      : null,
    linkedTrade: validLinkedTrade
      ? {
          tradeId: linkedTrade.tradeId,
          escrowContract,
          hiddenLiquidity,
          ...(preview?.offer ? { offer: buildSafeAsset(preview.offer, !hiddenLiquidity) } : {}),
          ...(preview?.request ? { request: buildSafeAsset(preview.request, !hiddenLiquidity) } : {})
        }
      : null
  };
};

const objectContainsTradeAgentSecret = (value: unknown, depth = 0): boolean => {
  if (typeof value === 'string') {
    return containsTradeAgentSecretText(value);
  }
  if (!value || typeof value !== 'object' || depth >= 6) {
    return false;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 50).some((item) => objectContainsTradeAgentSecret(item, depth + 1));
  }
  return Object.entries(value as Record<string, unknown>)
    .slice(0, 80)
    .some(([key, item]) =>
      (SECRET_KEY_PATTERN.test(key) && item !== null && item !== undefined && item !== '') ||
      objectContainsTradeAgentSecret(item, depth + 1)
    );
};

const getPromptKnownTokenMentions = (
  prompt: string,
  knownTokens: readonly TradeAgentKnownToken[]
): TradeAgentKnownToken[] => {
  const aliasMap = new Map<string, TradeAgentKnownToken>();
  knownTokens.forEach((token) => {
    [token.reference, ...(token.aliases ?? [])].forEach((alias) => {
      buildTokenAliases(alias).forEach((key) => aliasMap.set(key, token));
    });
  });
  const mentions: TradeAgentKnownToken[] = [];
  prompt
    .toLowerCase()
    .split(/[^a-z0-9.]+/i)
    .flatMap((token) => [normalizeTokenAlias(token), compactTokenAlias(token)])
    .filter(Boolean)
    .forEach((token) => {
      const known = aliasMap.get(token);
      if (known && !mentions.some((item) => item.reference.toLowerCase() === known.reference.toLowerCase())) {
        mentions.push(known);
      }
    });
  return mentions;
};

const hasTrustedOrderContext = (context: unknown): boolean => {
  if (!context || typeof context !== 'object') {
    return false;
  }
  const record = context as Record<string, unknown>;
  const explicit = record.explicit && typeof record.explicit === 'object'
    ? record.explicit as Record<string, unknown>
    : null;
  const candidate =
    (record.openedOrder && typeof record.openedOrder === 'object' ? record.openedOrder : null) ??
    (record.linkedTrade && typeof record.linkedTrade === 'object' ? record.linkedTrade : null) ??
    (explicit?.openedOrder && typeof explicit.openedOrder === 'object' ? explicit.openedOrder : null);
  if (!candidate) {
    return false;
  }
  const order = candidate as Record<string, unknown>;
  const tradeId = typeof order.tradeId === 'number' ? order.tradeId : order.id;
  return (
    typeof tradeId === 'number' &&
    Number.isSafeInteger(tradeId) &&
    tradeId > 0 &&
    isWalletAddress(normalizeString(order.escrowContract))
  );
};

const getDirectedAmount = (prompt: string): string =>
  prompt.match(/\b(?:buy|sell)\s+(-?\d+(?:\.\d+)?)/i)?.[1] ?? '';

const getPromptPrice = (prompt: string): string =>
  prompt.match(/\b(?:at|price(?:\s+of)?(?:\s*:|\s+))\s*(-?\d+(?:\.\d+)?)/i)?.[1] ?? '';

const isPositivePromptAmount = (value: string, decimals = 18): boolean =>
  Boolean(normalizePositiveAmountInput(value, decimals));

export const getTradeAgentPreflightError = ({
  action,
  context,
  knownTokens = [],
  prompt
}: {
  action: TradeAgentActionType;
  context: unknown;
  knownTokens?: readonly TradeAgentKnownToken[];
  prompt: string;
}): string => {
  const question = prompt.trim();
  if (!question) {
    return 'Enter what you want the Trade Agent to do.';
  }
  if (question.length > 4_000) {
    return 'Keep the Trade Agent request under 4,000 characters.';
  }
  if (/\[[^\]]+\]/.test(question)) {
    return 'Replace every bracketed placeholder before paying.';
  }
  if (containsTradeAgentSecretText(question) || objectContainsTradeAgentSecret(context)) {
    return 'Remove private keys, recovery words, access secrets, and private order links before using Trade Agent.';
  }

  if (action === 'explain_order' || action === 'draft_counter') {
    return hasTrustedOrderContext(context) ? '' : 'Open a specific order before using this action.';
  }
  if (action === 'review_orders') {
    const orders =
      context && typeof context === 'object' && Array.isArray((context as Record<string, unknown>).orders)
        ? (context as { orders: unknown[] }).orders
        : [];
    return orders.length > 0 && orders.length <= 20 ? '' : 'There are no safe order summaries to review.';
  }
  if (action === 'chat_to_trade') {
    const selectedMessage =
      context && typeof context === 'object'
        ? (context as Record<string, unknown>).selectedMessage
        : null;
    const text =
      selectedMessage && typeof selectedMessage === 'object'
        ? normalizeString((selectedMessage as Record<string, unknown>).text)
        : '';
    return text ? '' : 'Select one chat message before asking Trade Agent to draft a trade.';
  }

  const mentions = getPromptKnownTokenMentions(question, knownTokens);
  if (mentions.length > 2) {
    return 'Name one token pair at a time so the Agent can respond clearly.';
  }

  if (action === 'draft_recurring') {
    const buyPrice = question.match(/\bbuy\s+price\s*:?\s*(-?\d+(?:\.\d+)?)/i)?.[1] ?? '';
    const sellPrice = question.match(/\bsell\s+price\s*:?\s*(-?\d+(?:\.\d+)?)/i)?.[1] ?? '';
    const buyLiquidity = question.match(/\b(?:buy\s+budget|quote\s+liquidity)\s*:?\s*(-?\d+(?:\.\d+)?)/i)?.[1] ?? '';
    const sellLiquidity = question.match(/\b(?:sell\s+inventory|base\s+liquidity)\s*:?\s*(-?\d+(?:\.\d+)?)/i)?.[1] ?? '';
    if (
      (buyPrice && !isPositivePromptAmount(buyPrice)) ||
      (sellPrice && !isPositivePromptAmount(sellPrice)) ||
      (buyLiquidity && !isPositivePromptAmount(buyLiquidity, mentions[1]?.decimals ?? 18)) ||
      (sellLiquidity && !isPositivePromptAmount(sellLiquidity, mentions[0]?.decimals ?? 18))
    ) {
      return 'Any recurring prices or liquidity you provide must be positive and use supported precision.';
    }
    return '';
  }

  const hasBuy = /\bbuy(?:ing)?\b/i.test(question);
  const hasSell = /\bsell(?:ing)?\b/i.test(question);
  if (hasBuy && hasSell) {
    return 'Choose one direction—buy or sell—for this request.';
  }
  const directedAmount = getDirectedAmount(question);
  if (directedAmount && !isPositivePromptAmount(directedAmount, mentions[0]?.decimals ?? 18)) {
    return 'Any amount you provide must be positive and use supported token precision.';
  }
  if (action === 'find_price') {
    return '';
  }
  if (action === 'draft_limit') {
    const price = getPromptPrice(question);
    if (price && !isPositivePromptAmount(price)) {
      return 'Any limit price you provide must be positive.';
    }
    return '';
  }
  return '';
};

class TradeAgentInvocationError extends Error {
  readonly status: number;
  readonly tradeAgentRetryable: boolean;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'TradeAgentInvocationError';
    this.status = status;
    this.tradeAgentRetryable =
      status === 408 || status === 425 || status === 429 || status >= 500;
  }
}

export const isTradeAgentTerminalPaymentError = (
  error: unknown
): error is Error & { status: number; tradeAgentRetryable: false } =>
  error instanceof Error &&
  'tradeAgentRetryable' in error &&
  (error as { tradeAgentRetryable?: unknown }).tradeAgentRetryable === false;

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
        throw new TradeAgentInvocationError(message, response.status);
      }
      throw new TradeAgentInvocationError('Trade Agent request failed.', response.status);
    }
    throw new Error(error.message || 'Trade Agent request failed.');
  }
  return data as T;
};

const normalizeTradeAgentFeeQuote = (value: unknown): TradeAgentFeeQuote => {
  const quote = value && typeof value === 'object' ? value as Partial<TradeAgentFeeQuote> : {};
  const feeAmountWei = normalizeString(quote.feeAmountWei);
  const feeRecipient = normalizeString(quote.feeRecipient);
  const feeTokenAddress = normalizeString(quote.feeTokenAddress);
  const feeTokenDecimals = typeof quote.feeTokenDecimals === 'number' ? quote.feeTokenDecimals : 6;
  if (
    !/^[1-9]\d*$/.test(feeAmountWei) ||
    !isWalletAddress(feeRecipient) ||
    !isWalletAddress(feeTokenAddress) ||
    feeRecipient.toLowerCase() !== TRADE_AGENT_FEE_RECIPIENT.toLowerCase() ||
    feeTokenAddress.toLowerCase() !== TRADE_AGENT_FEE_TOKEN_ADDRESS.toLowerCase() ||
    feeTokenDecimals !== 6
  ) {
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

export const fetchTradeAgentFeeEstimate = async (
  action: TradeAgentActionType,
  context: unknown = {},
  prompt = ''
): Promise<TradeAgentFeeQuote> => {
  try {
    return normalizeTradeAgentFeeQuote(
      await invokeTradeAgentFunction<unknown>({ kind: 'estimate', action, context, prompt })
    );
  } catch (error) {
    const message = error instanceof Error ? error.message.toLowerCase() : '';
    if (!message.includes('request kind is not supported')) {
      throw error;
    }
    // Transitional display-only fallback for the previously deployed Edge Function.
    // Final authorization still requires the strict v2 quote schema before any transfer.
    return normalizeTradeAgentFeeQuote(
      await invokeTradeAgentFunction<unknown>({ kind: 'quote', action, context, prompt })
    );
  }
};

export type CreateTradeAgentPaymentQuoteInput = {
  action: TradeAgentActionType;
  context: unknown;
  payerAddress: string;
  prompt: string;
};

const REQUEST_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const REQUEST_HASH_RE = /^0x[0-9a-f]{64}$/;

export const createTradeAgentPaymentQuote = async (
  input: CreateTradeAgentPaymentQuoteInput
): Promise<TradeAgentPaymentQuote> => {
  const value = await invokeTradeAgentFunction<unknown>({
    kind: 'quote',
    action: input.action,
    context: input.context,
    payerAddress: input.payerAddress,
    prompt: input.prompt
  });
  if (!value || typeof value !== 'object') {
    throw new Error('Trade Agent payment quote is invalid.');
  }
  const record = value as Record<string, unknown>;
  const fee = normalizeTradeAgentFeeQuote(record);
  const requestId = normalizeString(record.requestId).toLowerCase();
  const requestHash = normalizeString(record.requestHash).toLowerCase();
  const quoteToken = normalizeString(record.quoteToken);
  const authorizationMessage = normalizeString(record.authorizationMessage);
  const issuedAt = normalizeString(record.issuedAt);
  const expiresAt = normalizeString(record.expiresAt);
  const issuedAtMs = Date.parse(issuedAt);
  const expiresAtMs = Date.parse(expiresAt);
  if (
    !REQUEST_ID_RE.test(requestId) ||
    !REQUEST_HASH_RE.test(requestHash) ||
    !quoteToken ||
    quoteToken.length > 16_000 ||
    !authorizationMessage ||
    authorizationMessage.length > 4_000 ||
    !Number.isFinite(issuedAtMs) ||
    !Number.isFinite(expiresAtMs) ||
    new Date(issuedAtMs).toISOString() !== issuedAt ||
    new Date(expiresAtMs).toISOString() !== expiresAt ||
    expiresAtMs <= issuedAtMs
  ) {
    throw new Error('Trade Agent payment quote is invalid.');
  }
  return {
    ...fee,
    authorizationMessage,
    expiresAt,
    issuedAt,
    quoteToken,
    requestHash,
    requestId
  };
};

const normalizeTradeAgentRunResult = (
  value: unknown,
  expectedRequestId: string,
  normalization?: TradeAgentNormalizationOptions
): TradeAgentRunResult => {
  if (!value || typeof value !== 'object') {
    throw new Error('Trade Agent returned an invalid request state.');
  }
  const record = value as Record<string, unknown>;
  const requestId = normalizeString(record.requestId).toLowerCase();
  const status = normalizeString(record.status);
  if (!REQUEST_ID_RE.test(requestId) || requestId !== expectedRequestId.toLowerCase()) {
    throw new Error('Trade Agent returned a mismatched request state.');
  }
  if (status === 'completed') {
    return {
      requestId,
      status,
      response: normalizeTradeAgentResponse(record.response, normalization)
    };
  }
  if (status === 'processing') {
    const retryAfterMs =
      typeof record.retryAfterMs === 'number' && Number.isFinite(record.retryAfterMs)
        ? Math.max(1_000, Math.min(120_000, Math.round(record.retryAfterMs)))
        : 2_000;
    return { requestId, status, retryAfterMs };
  }
  if (status === 'retryable') {
    return { requestId, status };
  }
  throw new Error('Trade Agent returned an invalid request state.');
};

export const runTradeAgentRequest = async (input: TradeAgentRunInput): Promise<TradeAgentRunResult> => {
  const response = await invokeTradeAgentFunction<unknown>({
    kind: 'run',
    action: input.action,
    context: input.context,
    payerAddress: input.payerAddress,
    payerSignature: input.payerSignature,
    paymentTxHash: input.paymentTxHash,
    prompt: input.prompt,
    quoteToken: input.quoteToken,
    requestHash: input.requestHash,
    requestId: input.requestId
  });
  return normalizeTradeAgentRunResult(response, input.requestId, input.normalization);
};

export const recoverTradeAgentRequest = async (
  input: TradeAgentRecoverInput
): Promise<TradeAgentRunResult> => {
  const response = await invokeTradeAgentFunction<unknown>({
    kind: 'recover',
    payerAddress: input.payerAddress,
    requestId: input.requestId,
    signature: input.signature,
    signedAt: input.signedAt
  });
  return normalizeTradeAgentRunResult(response, input.requestId, input.normalization);
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
