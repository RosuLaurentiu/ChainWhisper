import { REWARD_TOKEN_ADDRESS } from './appShared';

export const TRADE_AGENT_PAYMENT_PROTOCOL = 'ChainWhisper Trade Agent';
export const TRADE_AGENT_PAYMENT_PROTOCOL_VERSION = 2 as const;
export const TRADE_AGENT_PAYMENT_CHAIN_ID = 2_632_500 as const;
export const TRADE_AGENT_PAYMENT_RETRY_STORAGE_KEY = 'chainwhisper:trade-agent-retry-payment:v2';
export const TRADE_AGENT_PAYMENT_RETRY_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1_000;
export const TRADE_AGENT_PAYMENT_MIN_TRANSFER_WINDOW_MS = 30_000;
export const TRADE_AGENT_PAYMENT_FEE_RECIPIENT = '0xbf01185A70CDfEF1858659836D57BFf085ebed55';
export const TRADE_AGENT_PAYMENT_FEE_TOKEN_ADDRESS = REWARD_TOKEN_ADDRESS;
export const TRADE_AGENT_PAYMENT_FEE_TOKEN_DECIMALS = 6;

const MAX_PROMPT_CHARS = 4_000;
const MAX_CONTEXT_CHARS = 14_000;
const MAX_QUOTE_TOKEN_CHARS = 4_096;

const ACTION_TYPES = new Set<TradeAgentPaymentAction>([
  'explain_order',
  'find_price',
  'draft_counter',
  'draft_limit',
  'draft_recurring',
  'review_orders',
  'chat_to_trade'
]);
const ADDRESS_RE = /^0x[a-f0-9]{40}$/u;
const HASH_RE = /^0x[a-f0-9]{64}$/u;
const REQUEST_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const SIGNATURE_RE = /^0x(?:[a-f0-9]{128}|[a-f0-9]{130})$/u;
const QUOTE_TOKEN_RE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u;
const PROHIBITED_KEY_RE =
  /^(?:access[_ -]?secret|private[_ -]?key|mnemonic|seed[_ -]?phrase|recovery[_ -]?phrase|secret|share[_ -]?code)$/iu;
const PRIVATE_LINK_RE =
  /\/(?:otc\/order|trades)\/(?:link|l)\/[A-Za-z0-9_-]+|[?&#]secret=|#0x[a-fA-F0-9]{64}\b/iu;
const LABELED_SECRET_RE =
  /\b(?:private\s*key|seed\s*phrase|recovery\s*phrase|mnemonic|access\s*secret)\b\s*(?::|=|is)?\s*(?:0x[a-fA-F0-9]{64}|[a-z]+(?:\s+[a-z]+){11,23})/iu;
const RAW_SECRET_HEX_RE = /\b0x[a-fA-F0-9]{64}\b/u;

export type TradeAgentPaymentAction =
  | 'explain_order'
  | 'find_price'
  | 'draft_counter'
  | 'draft_limit'
  | 'draft_recurring'
  | 'review_orders'
  | 'chat_to_trade';

export type TradeAgentSafeJsonValue =
  | null
  | boolean
  | number
  | string
  | TradeAgentSafeJsonValue[]
  | { [key: string]: TradeAgentSafeJsonValue };

export type TradeAgentSafeContext = { [key: string]: TradeAgentSafeJsonValue };

export type TradeAgentPaymentRequest = {
  action: TradeAgentPaymentAction;
  context: TradeAgentSafeContext;
  payerAddress: string;
  prompt: string;
};

export type TradeAgentPaymentQuote = {
  authorizationMessage: string;
  expiresAt: string;
  feeAmountWei: string;
  feeRecipient: string;
  feeTokenAddress: string;
  feeTokenDecimals: number;
  feeTokenSymbol: string;
  issuedAt: string;
  quoteToken: string;
  requestHash: string;
  requestId: string;
};

export type TradeAgentPaymentRetryRecord = {
  version: typeof TRADE_AGENT_PAYMENT_PROTOCOL_VERSION;
  action: TradeAgentPaymentAction;
  context: TradeAgentSafeContext;
  payerAddress: string;
  prompt: string;
  requestId: string;
  requestHash: string;
  quoteToken: string;
  payerSignature: string;
  paymentTxHash: string;
  issuedAt: string;
  expiresAt: string;
};

export type TradeAgentPaymentCompletedResult<T> = {
  requestId: string;
  status: 'completed';
  response: T;
};

export type TradeAgentPaymentProcessingResult = {
  requestId: string;
  status: 'processing';
  retryAfterMs?: number;
};

export type TradeAgentPaymentRetryableResult = {
  requestId: string;
  status: 'retryable';
  error?: string;
};

export type TradeAgentPaymentResult<T> =
  | TradeAgentPaymentCompletedResult<T>
  | TradeAgentPaymentProcessingResult
  | TradeAgentPaymentRetryableResult;

export type TradeAgentPaymentStorage = Pick<Storage, 'getItem' | 'removeItem' | 'setItem'>;

export type TradeAgentPaymentCallbacks = {
  createQuote: (request: TradeAgentPaymentRequest) => Promise<TradeAgentPaymentQuote>;
  signAuthorization: (input: {
    authorizationMessage: string;
    quote: TradeAgentPaymentQuote;
    request: TradeAgentPaymentRequest;
  }) => Promise<string>;
  transferPayment: (input: {
    payerSignature: string;
    quote: TradeAgentPaymentQuote;
    request: TradeAgentPaymentRequest;
  }) => Promise<string>;
  runRequest: (record: TradeAgentPaymentRetryRecord) => Promise<unknown>;
};

export type OrchestrateTradeAgentPaymentInput = {
  callbacks: TradeAgentPaymentCallbacks;
  onPaidRequest?: (
    record: TradeAgentPaymentRetryRecord,
    persistence: { persisted: boolean; storageError?: string }
  ) => void;
  request: TradeAgentPaymentRequest;
  retryRecord?: TradeAgentPaymentRetryRecord | null;
  storage?: TradeAgentPaymentStorage | null;
  now?: () => number;
};

const getDefaultStorage = (): TradeAgentPaymentStorage | null => {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
};

const normalizeAddress = (value: string): string => value.trim().toLowerCase();
const normalizeHash = (value: string): string => value.trim().toLowerCase();
const normalizeRequestId = (value: string): string => value.trim().toLowerCase();

const isCanonicalIsoDate = (value: string): boolean => {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
};

const assertNoProhibitedMaterial = (value: unknown): void => {
  if (typeof value === 'string') {
    if (PRIVATE_LINK_RE.test(value) || LABELED_SECRET_RE.test(value) || RAW_SECRET_HEX_RE.test(value)) {
      throw new Error('Trade Agent request contains private material.');
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach(assertNoProhibitedMaterial);
    return;
  }
  if (!value || typeof value !== 'object') {
    return;
  }
  Object.entries(value as Record<string, unknown>).forEach(([key, nested]) => {
    if (PROHIBITED_KEY_RE.test(key) && nested !== null && nested !== undefined && nested !== '') {
      throw new Error('Trade Agent request contains private material.');
    }
    assertNoProhibitedMaterial(nested);
  });
};

const normalizeStableValue = (value: unknown): TradeAgentSafeJsonValue => {
  if (Array.isArray(value)) {
    return value.map(normalizeStableValue);
  }
  if (value && typeof value === 'object') {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error('Trade Agent request contains an unsupported value.');
    }
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, nested]) => nested !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, normalizeStableValue(nested)])
    );
  }
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  ) {
    return value;
  }
  throw new Error('Trade Agent request contains an unsupported value.');
};

export const stableStringifyTradeAgentPaymentValue = (value: unknown): string =>
  JSON.stringify(normalizeStableValue(value));

const normalizeSafeContext = (value: unknown): TradeAgentSafeContext => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Trade Agent context must be a safe object.');
  }
  assertNoProhibitedMaterial(value);
  const context = normalizeStableValue(value);
  if (!context || typeof context !== 'object' || Array.isArray(context)) {
    throw new Error('Trade Agent context must be a safe object.');
  }
  if (JSON.stringify(context).length > MAX_CONTEXT_CHARS) {
    throw new Error('Trade Agent context is too large.');
  }
  return context;
};

export const normalizeTradeAgentPaymentRequest = (
  value: TradeAgentPaymentRequest
): TradeAgentPaymentRequest => {
  const action = value.action;
  const prompt = typeof value.prompt === 'string' ? value.prompt.trim() : '';
  const payerAddress = typeof value.payerAddress === 'string' ? normalizeAddress(value.payerAddress) : '';
  if (!ACTION_TYPES.has(action)) {
    throw new Error('Trade Agent action is not supported.');
  }
  if (!prompt || prompt.length > MAX_PROMPT_CHARS) {
    throw new Error('Trade Agent prompt is invalid.');
  }
  if (!ADDRESS_RE.test(payerAddress)) {
    throw new Error('Trade Agent payer address is invalid.');
  }
  assertNoProhibitedMaterial(prompt);
  return {
    action,
    context: normalizeSafeContext(value.context),
    payerAddress,
    prompt
  };
};

const bytesToHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');

export const hashTradeAgentPaymentRequest = async (
  request: TradeAgentPaymentRequest
): Promise<string> => {
  const normalized = normalizeTradeAgentPaymentRequest(request);
  const canonicalRequest = stableStringifyTradeAgentPaymentValue({
    action: normalized.action,
    context: normalized.context,
    prompt: normalized.prompt,
    version: TRADE_AGENT_PAYMENT_PROTOCOL_VERSION
  });
  const digest = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalRequest))
  );
  return `0x${bytesToHex(digest)}`;
};

export const getTradeAgentPaymentRequestKey = (
  request: TradeAgentPaymentRequest
): string => {
  const normalized = normalizeTradeAgentPaymentRequest(request);
  return stableStringifyTradeAgentPaymentValue({
    action: normalized.action,
    context: normalized.context,
    payerAddress: normalized.payerAddress,
    prompt: normalized.prompt,
    version: TRADE_AGENT_PAYMENT_PROTOCOL_VERSION
  });
};

const buildTradeAgentAuthorizationMessage = ({
  quote,
  request
}: {
  quote: Omit<TradeAgentPaymentQuote, 'authorizationMessage'>;
  request: TradeAgentPaymentRequest;
}): string => [
  `${TRADE_AGENT_PAYMENT_PROTOCOL} payment authorization`,
  `Version: ${TRADE_AGENT_PAYMENT_PROTOCOL_VERSION}`,
  `Chain ID: ${TRADE_AGENT_PAYMENT_CHAIN_ID}`,
  `Request ID: ${quote.requestId}`,
  `Request hash: ${quote.requestHash}`,
  `Action: ${request.action}`,
  `Payer: ${request.payerAddress}`,
  `Fee token: ${quote.feeTokenAddress}`,
  `Fee amount (base units): ${quote.feeAmountWei}`,
  `Fee recipient: ${quote.feeRecipient}`,
  `Issued at: ${quote.issuedAt}`,
  `Expires at: ${quote.expiresAt}`,
  'This signature authorizes one public WISP payment and does not execute a trade.'
].join('\n');

const normalizeTradeAgentPaymentQuote = async (
  value: TradeAgentPaymentQuote,
  request: TradeAgentPaymentRequest,
  now: number
): Promise<TradeAgentPaymentQuote> => {
  if (!value || typeof value !== 'object') {
    throw new Error('Trade Agent payment quote is invalid.');
  }
  const quote: TradeAgentPaymentQuote = {
    authorizationMessage:
      typeof value.authorizationMessage === 'string' ? value.authorizationMessage : '',
    expiresAt: typeof value.expiresAt === 'string' ? value.expiresAt : '',
    feeAmountWei: typeof value.feeAmountWei === 'string' ? value.feeAmountWei : '',
    feeRecipient: typeof value.feeRecipient === 'string' ? normalizeAddress(value.feeRecipient) : '',
    feeTokenAddress:
      typeof value.feeTokenAddress === 'string' ? normalizeAddress(value.feeTokenAddress) : '',
    feeTokenDecimals: value.feeTokenDecimals,
    feeTokenSymbol: typeof value.feeTokenSymbol === 'string' ? value.feeTokenSymbol.trim() : '',
    issuedAt: typeof value.issuedAt === 'string' ? value.issuedAt : '',
    quoteToken: typeof value.quoteToken === 'string' ? value.quoteToken.trim() : '',
    requestHash: typeof value.requestHash === 'string' ? normalizeHash(value.requestHash) : '',
    requestId: typeof value.requestId === 'string' ? normalizeRequestId(value.requestId) : ''
  };
  if (
    !REQUEST_ID_RE.test(quote.requestId) ||
    !HASH_RE.test(quote.requestHash) ||
    !QUOTE_TOKEN_RE.test(quote.quoteToken) ||
    quote.quoteToken.length > MAX_QUOTE_TOKEN_CHARS ||
    !/^[1-9]\d*$/u.test(quote.feeAmountWei) ||
    !ADDRESS_RE.test(quote.feeRecipient) ||
    quote.feeRecipient !== normalizeAddress(TRADE_AGENT_PAYMENT_FEE_RECIPIENT) ||
    !ADDRESS_RE.test(quote.feeTokenAddress) ||
    quote.feeTokenAddress !== normalizeAddress(TRADE_AGENT_PAYMENT_FEE_TOKEN_ADDRESS) ||
    !Number.isSafeInteger(quote.feeTokenDecimals) ||
    quote.feeTokenDecimals !== TRADE_AGENT_PAYMENT_FEE_TOKEN_DECIMALS ||
    quote.feeTokenSymbol !== 'WISP' ||
    !isCanonicalIsoDate(quote.issuedAt) ||
    !isCanonicalIsoDate(quote.expiresAt) ||
    Date.parse(quote.expiresAt) <= Date.parse(quote.issuedAt) ||
    Date.parse(quote.expiresAt) <= now
  ) {
    throw new Error('Trade Agent payment quote is invalid.');
  }
  if (quote.requestHash !== await hashTradeAgentPaymentRequest(request)) {
    throw new Error('Trade Agent payment quote does not match this request.');
  }
  const expectedAuthorizationMessage = buildTradeAgentAuthorizationMessage({ quote, request });
  if (quote.authorizationMessage !== expectedAuthorizationMessage) {
    throw new Error('Trade Agent payment authorization does not match this request.');
  }
  return quote;
};

const RETRY_RECORD_KEYS = [
  'version',
  'action',
  'context',
  'payerAddress',
  'prompt',
  'requestId',
  'requestHash',
  'quoteToken',
  'payerSignature',
  'paymentTxHash',
  'issuedAt',
  'expiresAt'
] as const;

const hasOnlyRetryRecordKeys = (value: Record<string, unknown>): boolean => {
  const keys = Object.keys(value).sort();
  return (
    keys.length === RETRY_RECORD_KEYS.length &&
    [...RETRY_RECORD_KEYS].sort().every((key, index) => keys[index] === key)
  );
};

const normalizeTradeAgentPaymentRetryRecord = (
  value: unknown,
  now = Date.now()
): TradeAgentPaymentRetryRecord => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Trade Agent retry record is invalid.');
  }
  const record = value as Record<string, unknown>;
  if (!hasOnlyRetryRecordKeys(record) || record.version !== TRADE_AGENT_PAYMENT_PROTOCOL_VERSION) {
    throw new Error('Trade Agent retry record is invalid.');
  }
  const request = normalizeTradeAgentPaymentRequest({
    action: record.action as TradeAgentPaymentAction,
    context: record.context as TradeAgentSafeContext,
    payerAddress: typeof record.payerAddress === 'string' ? record.payerAddress : '',
    prompt: typeof record.prompt === 'string' ? record.prompt : ''
  });
  const requestId =
    typeof record.requestId === 'string' ? normalizeRequestId(record.requestId) : '';
  const requestHash =
    typeof record.requestHash === 'string' ? normalizeHash(record.requestHash) : '';
  const quoteToken = typeof record.quoteToken === 'string' ? record.quoteToken.trim() : '';
  const payerSignature =
    typeof record.payerSignature === 'string' ? record.payerSignature.trim().toLowerCase() : '';
  const paymentTxHash =
    typeof record.paymentTxHash === 'string' ? normalizeHash(record.paymentTxHash) : '';
  const issuedAt = typeof record.issuedAt === 'string' ? record.issuedAt : '';
  const expiresAt = typeof record.expiresAt === 'string' ? record.expiresAt : '';
  if (
    !REQUEST_ID_RE.test(requestId) ||
    !HASH_RE.test(requestHash) ||
    !QUOTE_TOKEN_RE.test(quoteToken) ||
    quoteToken.length > MAX_QUOTE_TOKEN_CHARS ||
    !SIGNATURE_RE.test(payerSignature) ||
    !HASH_RE.test(paymentTxHash) ||
    !isCanonicalIsoDate(issuedAt) ||
    !isCanonicalIsoDate(expiresAt) ||
    Date.parse(expiresAt) <= Date.parse(issuedAt) ||
    now - Date.parse(issuedAt) > TRADE_AGENT_PAYMENT_RETRY_MAX_AGE_MS
  ) {
    throw new Error('Trade Agent retry record is invalid.');
  }
  return {
    version: TRADE_AGENT_PAYMENT_PROTOCOL_VERSION,
    ...request,
    requestId,
    requestHash,
    quoteToken,
    payerSignature,
    paymentTxHash,
    issuedAt,
    expiresAt
  };
};

export const readTradeAgentPaymentRetry = (
  storage: TradeAgentPaymentStorage | null = getDefaultStorage(),
  now = Date.now()
): TradeAgentPaymentRetryRecord | null => {
  if (!storage) {
    return null;
  }
  try {
    const raw = storage.getItem(TRADE_AGENT_PAYMENT_RETRY_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    return normalizeTradeAgentPaymentRetryRecord(JSON.parse(raw), now);
  } catch {
    try {
      storage.removeItem(TRADE_AGENT_PAYMENT_RETRY_STORAGE_KEY);
    } catch {
      // Storage may be unavailable; a malformed record is never returned.
    }
    return null;
  }
};

export const writeTradeAgentPaymentRetry = (
  record: TradeAgentPaymentRetryRecord,
  storage: TradeAgentPaymentStorage | null = getDefaultStorage(),
  now = Date.now()
): TradeAgentPaymentRetryRecord => {
  const normalized = normalizeTradeAgentPaymentRetryRecord(record, now);
  if (!storage) {
    throw new Error('Trade Agent retry storage is unavailable.');
  }
  storage.setItem(TRADE_AGENT_PAYMENT_RETRY_STORAGE_KEY, JSON.stringify(normalized));
  return normalized;
};

const hasSamePaidRequestIdentity = (
  left: TradeAgentPaymentRetryRecord,
  right: TradeAgentPaymentRetryRecord
): boolean =>
  left.requestId === right.requestId &&
  left.requestHash === right.requestHash &&
  left.paymentTxHash === right.paymentTxHash;

export const clearTradeAgentPaymentRetry = (
  storage: TradeAgentPaymentStorage | null = getDefaultStorage(),
  expectedRecord?: TradeAgentPaymentRetryRecord,
  now = Date.now()
): void => {
  if (!storage) {
    return;
  }
  if (expectedRecord) {
    const current = readTradeAgentPaymentRetry(storage, now);
    if (!current || !hasSamePaidRequestIdentity(current, expectedRecord)) {
      return;
    }
  }
  try {
    storage.removeItem(TRADE_AGENT_PAYMENT_RETRY_STORAGE_KEY);
  } catch {
    // Clearing retry state is best-effort.
  }
};

export const doesTradeAgentPaymentRetryMatch = (
  record: TradeAgentPaymentRetryRecord,
  request: TradeAgentPaymentRequest
): boolean =>
  getTradeAgentPaymentRequestKey(record) === getTradeAgentPaymentRequestKey(request);

export const buildTradeAgentRecoveryMessage = ({
  payerAddress,
  requestId,
  signedAt
}: {
  payerAddress: string;
  requestId: string;
  signedAt: string;
}): string => {
  const payer = normalizeAddress(payerAddress);
  const normalizedRequestId = normalizeRequestId(requestId);
  if (
    !ADDRESS_RE.test(payer) ||
    !REQUEST_ID_RE.test(normalizedRequestId) ||
    !isCanonicalIsoDate(signedAt)
  ) {
    throw new Error('Trade Agent recovery request is invalid.');
  }
  return [
    `${TRADE_AGENT_PAYMENT_PROTOCOL} response recovery`,
    `Version: ${TRADE_AGENT_PAYMENT_PROTOCOL_VERSION}`,
    `Chain ID: ${TRADE_AGENT_PAYMENT_CHAIN_ID}`,
    `Request ID: ${normalizedRequestId}`,
    `Payer: ${payer}`,
    `Signed at: ${signedAt}`,
    'This is a read-only request to recover one paid Agent response.'
  ].join('\n');
};

export const normalizeTradeAgentPaymentResult = <T>(
  value: unknown,
  expectedRequestId: string
): TradeAgentPaymentResult<T> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Trade Agent payment result is invalid.');
  }
  const result = value as Record<string, unknown>;
  const requestId =
    typeof result.requestId === 'string' ? normalizeRequestId(result.requestId) : '';
  if (!REQUEST_ID_RE.test(requestId) || requestId !== expectedRequestId) {
    throw new Error('Trade Agent payment result is for another request.');
  }
  if (result.status === 'completed') {
    if (!Object.prototype.hasOwnProperty.call(result, 'response')) {
      throw new Error('Trade Agent completed result has no response.');
    }
    return { requestId, status: 'completed', response: result.response as T };
  }
  if (result.status === 'processing') {
    const retryAfterMs = result.retryAfterMs;
    if (
      retryAfterMs !== undefined &&
      (!Number.isSafeInteger(retryAfterMs) || (retryAfterMs as number) <= 0)
    ) {
      throw new Error('Trade Agent processing result is invalid.');
    }
    return {
      requestId,
      status: 'processing',
      ...(typeof retryAfterMs === 'number' ? { retryAfterMs } : {})
    };
  }
  if (result.status === 'retryable') {
    return { requestId, status: 'retryable' };
  }
  throw new Error('Trade Agent payment result is invalid.');
};

const getErrorMessage = (error: unknown): string =>
  error instanceof Error && error.message.trim()
    ? error.message.trim().slice(0, 500)
    : 'Trade Agent request can be retried without another payment.';

const isTerminalRunError = (error: unknown): boolean =>
  error instanceof Error &&
  'tradeAgentRetryable' in error &&
  (error as { tradeAgentRetryable?: unknown }).tradeAgentRetryable === false;

export const orchestrateTradeAgentPayment = async <T>({
  callbacks,
  onPaidRequest,
  request,
  retryRecord = null,
  storage = getDefaultStorage(),
  now = Date.now
}: OrchestrateTradeAgentPaymentInput): Promise<TradeAgentPaymentResult<T>> => {
  const normalizedRequest = normalizeTradeAgentPaymentRequest(request);
  const storedRetry = readTradeAgentPaymentRetry(storage, now());
  let inMemoryRetry: TradeAgentPaymentRetryRecord | null = null;
  if (retryRecord) {
    try {
      inMemoryRetry = normalizeTradeAgentPaymentRetryRecord(retryRecord, now());
    } catch {
      inMemoryRetry = null;
    }
  }
  const expectedRequestHash = await hashTradeAgentPaymentRequest(normalizedRequest);
  const storedRetryMatchesRequest = Boolean(
    storedRetry && doesTradeAgentPaymentRetryMatch(storedRetry, normalizedRequest)
  );
  const inMemoryRetryMatchesRequest = Boolean(
    inMemoryRetry && doesTradeAgentPaymentRetryMatch(inMemoryRetry, normalizedRequest)
  );
  const reusableRetry =
    inMemoryRetry &&
    inMemoryRetryMatchesRequest &&
    inMemoryRetry.requestHash === expectedRequestHash
      ? inMemoryRetry
      : storedRetry &&
          storedRetryMatchesRequest &&
          storedRetry.requestHash === expectedRequestHash
        ? storedRetry
        : null;
  let paidRequest: TradeAgentPaymentRetryRecord;

  if (reusableRetry) {
    paidRequest = reusableRetry;
  } else {
    if (storedRetry && storedRetryMatchesRequest) {
      clearTradeAgentPaymentRetry(storage, storedRetry, now());
    }
    const quote = await normalizeTradeAgentPaymentQuote(
      await callbacks.createQuote(normalizedRequest),
      normalizedRequest,
      now()
    );
    const payerSignature = (
      await callbacks.signAuthorization({
        authorizationMessage: quote.authorizationMessage,
        quote,
        request: normalizedRequest
      })
    ).trim().toLowerCase();
    if (!SIGNATURE_RE.test(payerSignature)) {
      throw new Error('Trade Agent payment authorization signature is invalid.');
    }
    if (Date.parse(quote.expiresAt) - now() < TRADE_AGENT_PAYMENT_MIN_TRANSFER_WINDOW_MS) {
      throw new Error('Trade Agent payment quote expired before payment.');
    }

    const paymentTxHash = normalizeHash(
      await callbacks.transferPayment({ payerSignature, quote, request: normalizedRequest })
    );
    if (!HASH_RE.test(paymentTxHash)) {
      throw new Error('Trade Agent WISP payment transaction is invalid.');
    }

    const record = normalizeTradeAgentPaymentRetryRecord(
      {
        version: TRADE_AGENT_PAYMENT_PROTOCOL_VERSION,
        ...normalizedRequest,
        requestId: quote.requestId,
        requestHash: quote.requestHash,
        quoteToken: quote.quoteToken,
        payerSignature,
        paymentTxHash,
        issuedAt: quote.issuedAt,
        expiresAt: quote.expiresAt
      },
      now()
    );
    let persisted = false;
    let storageError = '';
    try {
      paidRequest = writeTradeAgentPaymentRetry(record, storage, now());
      persisted = true;
    } catch (error) {
      paidRequest = record;
      storageError = getErrorMessage(error);
    }
    try {
      onPaidRequest?.(paidRequest, {
        persisted,
        ...(storageError ? { storageError } : {})
      });
    } catch {
      // UI state notification must not prevent a paid request from running.
    }
  }

  try {
    const result = normalizeTradeAgentPaymentResult<T>(
      await callbacks.runRequest(paidRequest),
      paidRequest.requestId
    );
    if (result.status === 'completed') {
      clearTradeAgentPaymentRetry(storage, paidRequest, now());
    }
    return result;
  } catch (error) {
    if (isTerminalRunError(error)) {
      throw error;
    }
    return {
      requestId: paidRequest.requestId,
      status: 'retryable',
      error: getErrorMessage(error)
    };
  }
};
