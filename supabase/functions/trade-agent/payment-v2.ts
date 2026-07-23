import { recoverMessageAddress, type Hex } from 'npm:viem@2.48.2';

export const TRADE_AGENT_PROTOCOL = 'ChainWhisper Trade Agent';
export const TRADE_AGENT_PROTOCOL_VERSION = 2;
export const COTI_CHAIN_ID = 2_632_500;
export const TRADE_AGENT_QUOTE_TTL_MS = 15 * 60 * 1_000;
export const TRADE_AGENT_RECOVERY_SIGNATURE_TTL_MS = 5 * 60 * 1_000;
export const TRADE_AGENT_RESPONSE_TTL_MS = 7 * 24 * 60 * 60 * 1_000;
export const TRADE_AGENT_PENDING_LEASE_MS = 2 * 60 * 1_000;

const textEncoder = new TextEncoder();
const HEX_32_RE = /^0x[a-f0-9]{64}$/u;
const ADDRESS_RE = /^0x[a-f0-9]{40}$/u;
const SIGNATURE_RE = /^0x(?:[a-f0-9]{128}|[a-f0-9]{130})$/u;

export type TradeAgentQuotePayload = {
  action: string;
  chainId: typeof COTI_CHAIN_ID;
  domain: typeof TRADE_AGENT_PROTOCOL;
  expiresAt: string;
  feeAmountWei: string;
  feeRecipient: string;
  feeTokenAddress: string;
  issuedAt: string;
  payerAddress: string;
  requestHash: string;
  requestId: string;
  version: typeof TRADE_AGENT_PROTOCOL_VERSION;
};

export type TradeAgentReceipt = {
  blockNumber?: string;
  from?: string;
  logs?: Array<{
    address?: string;
    data?: string;
    topics?: string[];
  }>;
  status?: string;
};

export type VerifyTradeAgentReceiptInput = {
  expiresAt: string;
  feeAmountWei: bigint;
  feeRecipient: string;
  feeTokenAddress: string;
  issuedAt: string;
  payerAddress: string;
  receipt: TradeAgentReceipt;
  transferTopic: string;
  transactionBlockTimestampSeconds: number;
};

const normalizeAddress = (value: string): string => value.trim().toLowerCase();

const isCanonicalIsoDate = (value: string): boolean => {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
};

const bytesToHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');

const encodeBase64Url = (bytes: Uint8Array): string => {
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/gu, '');
};

const decodeBase64Url = (value: string): Uint8Array => {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) {
    throw new Error('Trade Agent quote token is invalid.');
  }
  const padding = '='.repeat((4 - value.length % 4) % 4);
  const binary = atob(value.replace(/-/gu, '+').replace(/_/gu, '/') + padding);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
};

const constantTimeEqual = (left: Uint8Array, right: Uint8Array): boolean => {
  const maxLength = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;
  for (let index = 0; index < maxLength; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
};

const importHmacKey = (secret: string): Promise<CryptoKey> => {
  if (secret.length < 32) {
    throw new Error('Trade Agent quote signing is not configured.');
  }
  return crypto.subtle.importKey(
    'raw',
    textEncoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
};

const signHmac = async (secret: string, value: string): Promise<Uint8Array> => {
  const key = await importHmacKey(secret);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, textEncoder.encode(value)));
};

const normalizeStableValue = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(normalizeStableValue);
  }
  if (value && typeof value === 'object') {
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

export const stableStringifyTradeAgentValue = (value: unknown): string =>
  JSON.stringify(normalizeStableValue(value));

export const hashTradeAgentRequest = async ({
  action,
  context,
  prompt
}: {
  action: string;
  context: unknown;
  prompt: string;
}): Promise<string> => {
  const canonicalRequest = stableStringifyTradeAgentValue({
    action,
    context,
    prompt,
    version: TRADE_AGENT_PROTOCOL_VERSION
  });
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', textEncoder.encode(canonicalRequest)));
  return `0x${bytesToHex(digest)}`;
};

const validateQuotePayload = (value: unknown): TradeAgentQuotePayload => {
  if (!value || typeof value !== 'object') {
    throw new Error('Trade Agent quote token is invalid.');
  }
  const payload = value as Partial<TradeAgentQuotePayload>;
  const payerAddress = normalizeAddress(String(payload.payerAddress ?? ''));
  const feeTokenAddress = normalizeAddress(String(payload.feeTokenAddress ?? ''));
  const feeRecipient = normalizeAddress(String(payload.feeRecipient ?? ''));
  if (
    payload.domain !== TRADE_AGENT_PROTOCOL ||
    payload.version !== TRADE_AGENT_PROTOCOL_VERSION ||
    payload.chainId !== COTI_CHAIN_ID ||
    typeof payload.action !== 'string' ||
    !payload.action ||
    typeof payload.requestId !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(payload.requestId) ||
    typeof payload.requestHash !== 'string' ||
    !HEX_32_RE.test(payload.requestHash) ||
    !ADDRESS_RE.test(payerAddress) ||
    !ADDRESS_RE.test(feeTokenAddress) ||
    !ADDRESS_RE.test(feeRecipient) ||
    typeof payload.feeAmountWei !== 'string' ||
    !/^[1-9]\d*$/u.test(payload.feeAmountWei) ||
    typeof payload.issuedAt !== 'string' ||
    !isCanonicalIsoDate(payload.issuedAt) ||
    typeof payload.expiresAt !== 'string' ||
    !isCanonicalIsoDate(payload.expiresAt) ||
    Date.parse(payload.expiresAt) <= Date.parse(payload.issuedAt)
  ) {
    throw new Error('Trade Agent quote token is invalid.');
  }
  return {
    action: payload.action,
    chainId: COTI_CHAIN_ID,
    domain: TRADE_AGENT_PROTOCOL,
    expiresAt: payload.expiresAt,
    feeAmountWei: payload.feeAmountWei,
    feeRecipient,
    feeTokenAddress,
    issuedAt: payload.issuedAt,
    payerAddress,
    requestHash: payload.requestHash,
    requestId: payload.requestId,
    version: TRADE_AGENT_PROTOCOL_VERSION
  };
};

export const createTradeAgentQuoteToken = async (
  payload: TradeAgentQuotePayload,
  secret: string
): Promise<string> => {
  const normalizedPayload = validateQuotePayload(payload);
  const payloadBytes = textEncoder.encode(stableStringifyTradeAgentValue(normalizedPayload));
  const encodedPayload = encodeBase64Url(payloadBytes);
  const signature = await signHmac(secret, encodedPayload);
  return `${encodedPayload}.${encodeBase64Url(signature)}`;
};

export const verifyTradeAgentQuoteToken = async (
  token: string,
  secret: string
): Promise<TradeAgentQuotePayload> => {
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error('Trade Agent quote token is invalid.');
  }
  const expectedSignature = await signHmac(secret, parts[0]);
  const suppliedSignature = decodeBase64Url(parts[1]);
  if (!constantTimeEqual(expectedSignature, suppliedSignature)) {
    throw new Error('Trade Agent quote token is invalid.');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(decodeBase64Url(parts[0])));
  } catch {
    throw new Error('Trade Agent quote token is invalid.');
  }
  return validateQuotePayload(parsed);
};

export const buildTradeAgentAuthorizationMessage = (payload: TradeAgentQuotePayload): string => {
  const quote = validateQuotePayload(payload);
  return [
    `${TRADE_AGENT_PROTOCOL} payment authorization`,
    `Version: ${TRADE_AGENT_PROTOCOL_VERSION}`,
    `Chain ID: ${COTI_CHAIN_ID}`,
    `Request ID: ${quote.requestId}`,
    `Request hash: ${quote.requestHash}`,
    `Action: ${quote.action}`,
    `Payer: ${quote.payerAddress}`,
    `Fee token: ${quote.feeTokenAddress}`,
    `Fee amount (base units): ${quote.feeAmountWei}`,
    `Fee recipient: ${quote.feeRecipient}`,
    `Issued at: ${quote.issuedAt}`,
    `Expires at: ${quote.expiresAt}`,
    'This signature authorizes one public WISP payment and does not execute a trade.'
  ].join('\n');
};

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
  if (
    !ADDRESS_RE.test(payer) ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(requestId) ||
    !isCanonicalIsoDate(signedAt)
  ) {
    throw new Error('Trade Agent recovery request is invalid.');
  }
  return [
    `${TRADE_AGENT_PROTOCOL} response recovery`,
    `Version: ${TRADE_AGENT_PROTOCOL_VERSION}`,
    `Chain ID: ${COTI_CHAIN_ID}`,
    `Request ID: ${requestId}`,
    `Payer: ${payer}`,
    `Signed at: ${signedAt}`,
    'This is a read-only request to recover one paid Agent response.'
  ].join('\n');
};

export const assertFreshTradeAgentRecoverySignature = (signedAt: string, now = Date.now()): void => {
  if (!isCanonicalIsoDate(signedAt)) {
    throw new Error('Trade Agent recovery timestamp is invalid.');
  }
  const timestamp = Date.parse(signedAt);
  if (timestamp > now + 30_000 || now - timestamp > TRADE_AGENT_RECOVERY_SIGNATURE_TTL_MS) {
    throw new Error('Trade Agent recovery signature has expired.');
  }
};

export const recoverTradeAgentMessageSigner = async ({
  message,
  signature
}: {
  message: string;
  signature: string;
}): Promise<string> => {
  const normalizedSignature = signature.trim().toLowerCase();
  if (!SIGNATURE_RE.test(normalizedSignature)) {
    throw new Error('Wallet signature is invalid.');
  }
  try {
    return normalizeAddress(await recoverMessageAddress({
      message,
      signature: normalizedSignature as Hex
    }));
  } catch {
    throw new Error('Wallet signature is invalid.');
  }
};

const topicForAddress = (address: string): string =>
  `0x${normalizeAddress(address).replace(/^0x/u, '').padStart(64, '0')}`;

export const verifyTradeAgentPaymentReceiptData = ({
  expiresAt,
  feeAmountWei,
  feeRecipient,
  feeTokenAddress,
  issuedAt,
  payerAddress,
  receipt,
  transactionBlockTimestampSeconds,
  transferTopic
}: VerifyTradeAgentReceiptInput): void => {
  const payer = normalizeAddress(payerAddress);
  const recipient = normalizeAddress(feeRecipient);
  const token = normalizeAddress(feeTokenAddress);
  if (
    !ADDRESS_RE.test(payer) ||
    !ADDRESS_RE.test(recipient) ||
    !ADDRESS_RE.test(token) ||
    receipt.status?.toLowerCase() !== '0x1' ||
    normalizeAddress(receipt.from ?? '') !== payer
  ) {
    throw new Error('WISP payment transaction is not confirmed for this payer.');
  }
  const blockTimeMs = transactionBlockTimestampSeconds * 1_000;
  if (
    !Number.isSafeInteger(transactionBlockTimestampSeconds) ||
    blockTimeMs < Date.parse(issuedAt) ||
    blockTimeMs > Date.parse(expiresAt)
  ) {
    throw new Error('WISP payment was not confirmed during the quoted payment window.');
  }
  const payerTopic = topicForAddress(payer);
  const recipientTopic = topicForAddress(recipient);
  const validTransfer = (receipt.logs ?? []).some((log) => {
    const topics = log.topics ?? [];
    if (
      normalizeAddress(log.address ?? '') !== token ||
      topics[0]?.toLowerCase() !== transferTopic.toLowerCase() ||
      topics[1]?.toLowerCase() !== payerTopic ||
      topics[2]?.toLowerCase() !== recipientTopic
    ) {
      return false;
    }
    try {
      return BigInt(log.data ?? '0x0') === feeAmountWei;
    } catch {
      return false;
    }
  });
  if (!validTransfer) {
    throw new Error('Payment transaction did not include the exact quoted WISP transfer.');
  }
};
