import {
  DIRECT_TRADE_ESCROW_CONTRACT_ADDRESS,
  decodeBase64Url,
  encodeBase64Url,
  formatTokenAmount,
  isWalletAddress,
  LEGACY_TRADE_REFERENCE_METADATA_PREFIX,
  PRIVATE_TRADE_ESCROW_CONTRACT_ADDRESS,
  RECURRING_OTC_CONTRACT_ADDRESS,
  shortenAddress,
  toSafeNumber,
  TRADE_ESCROW_CONTRACT_ADDRESS,
  TRADE_OFFER_MESSAGE_PREFIX,
  TRADE_REFERENCE_METADATA_PREFIX,
  TRADE_RESPONSE_MESSAGE_PREFIX,
  type TradeAssetPayload,
  type TradeMessageReferencePayload,
  type TradeOfferMessagePayload,
  type TradeResponseMessagePayload
} from './core';
import { decodeTradeLink, encodeTradeLink } from '../tradeLinks';

const TRADE_REFERENCE_METADATA_PREFIXES = [
  TRADE_REFERENCE_METADATA_PREFIX,
  LEGACY_TRADE_REFERENCE_METADATA_PREFIX
] as const;

const decodeStructuredChatPayload = <TPayload extends object>(text: string, prefix: string): TPayload | null => {
  if (!text.startsWith(prefix)) {
    return null;
  }

  const encodedPayload = text.slice(prefix.length).trim();
  if (!encodedPayload) {
    return null;
  }

  try {
    const decodedPayload = decodeBase64Url(encodedPayload);
    const parsedPayload = JSON.parse(decodedPayload) as TPayload;
    return parsedPayload && typeof parsedPayload === 'object' ? parsedPayload : null;
  } catch {
    return null;
  }
};

const normalizeTradeAmountValue = (value: unknown): string | undefined => {
  if (typeof value === 'string') {
    const normalized = value.trim();
    return /^\d+$/.test(normalized) ? normalized : undefined;
  }
  if (typeof value === 'bigint') {
    return value >= 0n ? value.toString() : undefined;
  }
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) {
    return String(value);
  }
  return undefined;
};

const normalizeTradeSymbol = (value: unknown): string | undefined => {
  const normalized = typeof value === 'string' ? value.trim().slice(0, 24) : '';
  return normalized || undefined;
};

const normalizeTradeAssetPayload = (value: unknown): TradeAssetPayload | null => {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const parsed = value as Partial<TradeAssetPayload>;
  const kind =
    parsed.kind === 'native' || parsed.kind === 'erc20' || parsed.kind === 'private-erc20'
      ? parsed.kind
      : undefined;
  const symbol = normalizeTradeSymbol(parsed.symbol);
  const amount = normalizeTradeAmountValue(parsed.amount);
  const decimalsRaw = typeof parsed.decimals === 'number' ? parsed.decimals : Number(parsed.decimals);
  const decimals =
    Number.isFinite(decimalsRaw) && decimalsRaw >= 0 ? Math.min(30, Math.floor(decimalsRaw)) : Number.NaN;
  const tokenAddress =
    typeof parsed.tokenAddress === 'string' && isWalletAddress(parsed.tokenAddress) ? parsed.tokenAddress : undefined;

  if (!kind || !symbol || !amount || !Number.isFinite(decimals)) {
    return null;
  }

  if (kind === 'native') {
    return {
      kind,
      symbol,
      decimals,
      amount,
      custom: Boolean(parsed.custom)
    };
  }

  if (!tokenAddress) {
    return null;
  }

  return {
    kind,
    tokenAddress,
    symbol,
    decimals,
    amount,
    custom: Boolean(parsed.custom)
  };
};

export const formatTradeAssetDisplayText = (asset: TradeAssetPayload): string => {
  try {
    return `${formatTokenAmount(BigInt(asset.amount), asset.decimals, 6)} ${asset.symbol}`;
  } catch {
    return `0 ${asset.symbol}`;
  }
};

export const buildTradeOfferMessagePayload = (payload: TradeOfferMessagePayload): string =>
  `${TRADE_OFFER_MESSAGE_PREFIX}${encodeBase64Url(JSON.stringify(payload))}`;

export const parseTradeOfferMessagePayload = (text: string): TradeOfferMessagePayload | null => {
  const parsed = decodeStructuredChatPayload<Partial<TradeOfferMessagePayload>>(text, TRADE_OFFER_MESSAGE_PREFIX);
  if (!parsed) {
    return null;
  }

  const tradeId = toSafeNumber(parsed.tradeId);
  const createdAt = toSafeNumber(parsed.createdAt);
  const expiresAt = toSafeNumber(parsed.expiresAt);
  const parentTradeId = toSafeNumber(parsed.parentTradeId);
  const accessSecret = typeof parsed.accessSecret === 'string' ? parsed.accessSecret.trim() : '';
  const escrowContract =
    typeof parsed.escrowContract === 'string' && isWalletAddress(parsed.escrowContract)
      ? parsed.escrowContract
      : TRADE_ESCROW_CONTRACT_ADDRESS;
  const maker = typeof parsed.maker === 'string' && isWalletAddress(parsed.maker) ? parsed.maker : undefined;
  const taker = typeof parsed.taker === 'string' && isWalletAddress(parsed.taker) ? parsed.taker : undefined;
  const offer = normalizeTradeAssetPayload(parsed.offer);
  const request = normalizeTradeAssetPayload(parsed.request);

  if (
    (parsed.version !== 1 && parsed.version !== 2) ||
    tradeId <= 0 ||
    createdAt <= 0 ||
    parsed.expiresAt === undefined ||
    parsed.expiresAt === null ||
    !maker ||
    !taker
  ) {
    return null;
  }

  if (parsed.version === 1 && (!offer || !request)) {
    return null;
  }

  return {
    version: parsed.version,
    tradeId,
    escrowContract,
    maker,
    taker,
    offer: offer ?? undefined,
    request: request ?? undefined,
    createdAt,
    expiresAt,
    parentTradeId: parentTradeId > 0 ? parentTradeId : undefined,
    hiddenLiquidity: parsed.hiddenLiquidity === true,
    accessSecret: /^0x[a-fA-F0-9]{64}$/.test(accessSecret) ? accessSecret : undefined
  };
};

export const buildTradeResponseMessagePayload = (payload: TradeResponseMessagePayload): string =>
  `${TRADE_RESPONSE_MESSAGE_PREFIX}${encodeBase64Url(JSON.stringify(payload))}`;

export const parseTradeResponseMessagePayload = (text: string): TradeResponseMessagePayload | null => {
  const parsed = decodeStructuredChatPayload<Partial<TradeResponseMessagePayload>>(text, TRADE_RESPONSE_MESSAGE_PREFIX);
  if (!parsed) {
    return null;
  }

  const tradeId = toSafeNumber(parsed.tradeId);
  const createdAt = toSafeNumber(parsed.createdAt);
  const counterTradeId = toSafeNumber(parsed.counterTradeId);
  const escrowContract =
    typeof parsed.escrowContract === 'string' && isWalletAddress(parsed.escrowContract)
      ? parsed.escrowContract
      : TRADE_ESCROW_CONTRACT_ADDRESS;
  const actor = typeof parsed.actor === 'string' && isWalletAddress(parsed.actor) ? parsed.actor : undefined;
  const action =
    parsed.action === 'accepted' ||
    parsed.action === 'declined' ||
    parsed.action === 'cancelled' ||
    parsed.action === 'countered'
      ? parsed.action
      : undefined;

  if (parsed.version !== 1 || tradeId <= 0 || createdAt <= 0 || !actor || !action) {
    return null;
  }

  return {
    version: 1,
    tradeId,
    escrowContract,
    action,
    actor,
    createdAt,
    counterTradeId: counterTradeId > 0 ? counterTradeId : undefined
  };
};

const TRADE_REFERENCE_TYPE_DIRECT = 'd';
const TRADE_REFERENCE_TYPE_PRIVATE = 'p';
const TRADE_REFERENCE_TYPE_RECURRING = 'r';

const getTradeReferenceTypeCode = (escrowContract?: string): string => {
  const normalized = escrowContract?.trim().toLowerCase() ?? '';
  if (normalized === DIRECT_TRADE_ESCROW_CONTRACT_ADDRESS.toLowerCase()) {
    return TRADE_REFERENCE_TYPE_DIRECT;
  }
  if (normalized === PRIVATE_TRADE_ESCROW_CONTRACT_ADDRESS.toLowerCase()) {
    return TRADE_REFERENCE_TYPE_PRIVATE;
  }
  if (normalized === RECURRING_OTC_CONTRACT_ADDRESS.toLowerCase()) {
    return TRADE_REFERENCE_TYPE_RECURRING;
  }
  return '';
};

const getTradeReferenceEscrowContract = (typeCode: string): string => {
  if (typeCode === TRADE_REFERENCE_TYPE_DIRECT) {
    return DIRECT_TRADE_ESCROW_CONTRACT_ADDRESS;
  }
  if (typeCode === TRADE_REFERENCE_TYPE_PRIVATE) {
    return PRIVATE_TRADE_ESCROW_CONTRACT_ADDRESS;
  }
  if (typeCode === TRADE_REFERENCE_TYPE_RECURRING) {
    return RECURRING_OTC_CONTRACT_ADDRESS;
  }
  return TRADE_ESCROW_CONTRACT_ADDRESS;
};

const buildTradeReferenceTerminalPath = (tradeId: number, escrowContract: string): string => {
  const typeCode = getTradeReferenceTypeCode(escrowContract);
  if (typeCode === TRADE_REFERENCE_TYPE_RECURRING) {
    return `/otc/order/recurring/${tradeId}`;
  }
  const escrowSearch =
    typeCode === TRADE_REFERENCE_TYPE_DIRECT
      ? '?escrow=direct'
      : typeCode === TRADE_REFERENCE_TYPE_PRIVATE
        ? '?escrow=private'
        : '';
  return `/otc/order/link/${encodeTradeLink(tradeId)}${escrowSearch}`;
};

const encodeTradeMessageReference = (tradeReference?: TradeMessageReferencePayload | null): string => {
  const tradeId = toSafeNumber(tradeReference?.tradeId);
  if (tradeId <= 0) {
    return '';
  }
  const typeCode = getTradeReferenceTypeCode(tradeReference?.escrowContract);
  return typeCode ? `${tradeId.toString(36)}:${typeCode}` : tradeId.toString(36);
};

const parseTradeMessageReference = (value: unknown): TradeMessageReferencePayload | null => {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : '';
  const match = raw.match(/^([0-9a-z]{1,10})(?::([dpr]))?$/);
  if (!match) {
    return null;
  }
  const tradeId = Number.parseInt(match[1], 36);
  if (!Number.isSafeInteger(tradeId) || tradeId <= 0) {
    return null;
  }
  const escrowContract = getTradeReferenceEscrowContract(match[2] ?? '');
  return {
    version: 1,
    tradeId,
    escrowContract,
    terminalPath: buildTradeReferenceTerminalPath(tradeId, escrowContract)
  };
};

const parseLegacyTradeReferencePath = (value: unknown): TradeMessageReferencePayload | null => {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw || raw.length > 220 || !raw.startsWith('/') || raw.startsWith('//')) {
    return null;
  }

  try {
    const url = new URL(raw, 'https://chainwhisper.local');
    const lowerPath = url.pathname.toLowerCase();
    if (
      !lowerPath.startsWith('/otc/order') &&
      !lowerPath.startsWith('/otcdesk/terminal') &&
      !lowerPath.startsWith('/trades/')
    ) {
      return null;
    }

    if (lowerPath.includes('/recurring')) {
      const recurringPathSegments = url.pathname.split('/').filter(Boolean);
      const recurringPathId = recurringPathSegments[recurringPathSegments.length - 1] ?? '';
      const tradeId = toSafeNumber(url.searchParams.get('order')) || toSafeNumber(recurringPathId);
      return tradeId > 0
        ? {
            version: 1,
            tradeId,
            escrowContract: RECURRING_OTC_CONTRACT_ADDRESS,
            terminalPath: buildTradeReferenceTerminalPath(tradeId, RECURRING_OTC_CONTRACT_ADDRESS)
          }
        : null;
    }

    const segments = url.pathname.split('/').filter(Boolean);
    const linkedTradeIndex = segments.findIndex((segment) => {
      const lowerSegment = segment.toLowerCase();
      return lowerSegment === 'l' || lowerSegment === 'link';
    });
    const code = linkedTradeIndex >= 0 ? segments[linkedTradeIndex + 1] : '';
    const decoded = code ? decodeTradeLink(code) : null;
    if (!decoded?.tradeId) {
      return null;
    }

    const escrow = url.searchParams.get('escrow')?.trim().toLowerCase() ?? '';
    const escrowContract =
      escrow === 'direct'
        ? DIRECT_TRADE_ESCROW_CONTRACT_ADDRESS
        : escrow === 'private'
          ? PRIVATE_TRADE_ESCROW_CONTRACT_ADDRESS
          : TRADE_ESCROW_CONTRACT_ADDRESS;
    return {
      version: 1,
      tradeId: decoded.tradeId,
      escrowContract,
      terminalPath: buildTradeReferenceTerminalPath(decoded.tradeId, escrowContract)
    };
  } catch {
    return null;
  }
};

export const buildMessageWithTradeReferencePayload = (
  plainText: string,
  tradeReference?: TradeMessageReferencePayload | null
): string => {
  const encodedReference = encodeTradeMessageReference(tradeReference);
  if (!encodedReference) {
    return plainText;
  }

  return `${TRADE_REFERENCE_METADATA_PREFIX}${encodedReference}${TRADE_REFERENCE_METADATA_PREFIX}${plainText}`;
};

export const parseMessageTradeReferencePayload = (
  text: string
): { cleanText: string; tradeReference?: TradeMessageReferencePayload } => {
  for (const prefix of TRADE_REFERENCE_METADATA_PREFIXES) {
    if (!text.startsWith(prefix)) {
      continue;
    }

    const metadataEnd = text.indexOf(prefix, prefix.length);
    if (metadataEnd <= prefix.length) {
      return { cleanText: text };
    }

    const metadataChunk = text.slice(prefix.length, metadataEnd);
    const tradeReference = parseTradeMessageReference(metadataChunk) ?? parseLegacyTradeReferencePath(metadataChunk);
    if (!tradeReference) {
      return { cleanText: text };
    }
    return {
      cleanText: text.slice(metadataEnd + prefix.length),
      tradeReference
    };
  }

  return { cleanText: text };
};

export const formatTradeOfferDisplayText = (
  payload: TradeOfferMessagePayload,
  direction?: 'incoming' | 'outgoing'
): string => {
  if (!payload.offer || !payload.request) {
    return `${direction === 'outgoing' ? 'Trade offer sent' : 'Trade offer'}: Escrow trade #${payload.tradeId}.`;
  }

  const offerLabel = formatTradeAssetDisplayText(payload.offer);
  const requestLabel = formatTradeAssetDisplayText(payload.request);
  const prefix = direction === 'outgoing' ? 'Trade offer sent' : 'Trade offer';
  if (payload.hiddenLiquidity) {
    return `${prefix}: private order at ${requestLabel} per ${offerLabel}.`;
  }
  return `${prefix}: ${offerLabel} for ${requestLabel}.`;
};

export const formatTradeResponseDisplayText = (
  payload: TradeResponseMessagePayload,
  direction?: 'incoming' | 'outgoing'
): string => {
  const actorLabel = direction === 'outgoing'
    ? 'You'
    : isWalletAddress(payload.actor)
      ? shortenAddress(payload.actor)
      : 'Counterparty';
  if (payload.action === 'accepted') {
    return `${actorLabel} accepted trade #${payload.tradeId}.`;
  }
  if (payload.action === 'declined') {
    return `${actorLabel} declined trade #${payload.tradeId}.`;
  }
  if (payload.action === 'cancelled') {
    return `${actorLabel} cancelled trade #${payload.tradeId}.`;
  }
  const counterSuffix = payload.counterTradeId ? ` New trade #${payload.counterTradeId}.` : '';
  return `${actorLabel} countered trade #${payload.tradeId}.${counterSuffix}`;
};
