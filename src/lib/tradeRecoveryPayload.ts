import type { JsonRpcSigner, Wallet } from '@coti-io/coti-ethers';
import type { TradeAssetPayload } from './appShared';
import { normalizeAccessHash } from './tradeLinks';

const RECOVERY_PAYLOAD_VERSION = 1;
const ENCRYPTED_PAYLOAD_VERSION = 1;
const IV_BYTES = 12;
const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder();

type RecoverySigner = Wallet | JsonRpcSigner;

export type TradeRecoveryAsset = Pick<TradeAssetPayload, 'kind' | 'tokenAddress' | 'amount'>;

export type TradeRecoveryPayload = {
  version: 1;
  kind: 'party' | 'private-order' | 'recurring-order';
  accessSecret?: string;
  maker: string;
  taker: string;
  offer?: TradeRecoveryAsset;
  request?: TradeRecoveryAsset;
  baseAsset?: TradeRecoveryAsset;
  quoteAsset?: TradeRecoveryAsset;
  buyTerms?: {
    baseAmount: string;
    quoteAmount: string;
  };
  sellTerms?: {
    baseAmount: string;
    quoteAmount: string;
  };
  initialBaseInventory?: string;
  initialQuoteInventory?: string;
  expiresAt?: number;
  parentEscrowContract?: string;
  parentTradeId?: number;
};

const bytesToHex = (bytes: Uint8Array): string =>
  `0x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;

const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer =>
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

const hexToBytes = (value: string): Uint8Array => {
  const normalized = value.trim().replace(/^0x/i, '');
  if (normalized.length % 2 !== 0 || !/^[a-fA-F0-9]*$/.test(normalized)) {
    throw new Error('Invalid encrypted trade recovery payload.');
  }
  const bytes = new Uint8Array(normalized.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(normalized.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
};

const normalizeBigintString = (value?: bigint | number | string): string | undefined => {
  if (value === undefined || value === null) {
    return undefined;
  }
  try {
    return BigInt(value).toString();
  } catch {
    return undefined;
  }
};

const canonicalAsset = (asset?: TradeRecoveryAsset): TradeRecoveryAsset | undefined =>
  asset
    ? {
        kind: asset.kind,
        tokenAddress: asset.tokenAddress?.trim() || undefined,
        amount: normalizeBigintString(asset.amount) ?? '0'
      }
    : undefined;

const readSignerAesKey = (signer: RecoverySigner): string => {
  const onboardInfo = signer.getUserOnboardInfo();
  const aesKey = typeof onboardInfo?.aesKey === 'string' ? onboardInfo.aesKey.trim() : '';
  if (!aesKey) {
    throw new Error('Unlock privacy before creating or recovering private trade links.');
  }
  return aesKey;
};

const deriveRecoveryKey = async (aesKey: string, usages: KeyUsage[]): Promise<CryptoKey> => {
  const keyDigest = await crypto.subtle.digest(
    'SHA-256',
    toArrayBuffer(TEXT_ENCODER.encode(`ChainWhisperTradeRecoveryV1:${aesKey}`))
  );
  return crypto.subtle.importKey('raw', keyDigest, { name: 'AES-GCM' }, false, usages);
};

export const buildTradeRecoveryPayload = (
  payload: Omit<TradeRecoveryPayload, 'version'>
): TradeRecoveryPayload => ({
  version: RECOVERY_PAYLOAD_VERSION,
  kind: payload.kind,
  accessSecret: normalizeAccessHash(payload.accessSecret),
  maker: payload.maker,
  taker: payload.taker,
  offer: canonicalAsset(payload.offer),
  request: canonicalAsset(payload.request),
  baseAsset: canonicalAsset(payload.baseAsset),
  quoteAsset: canonicalAsset(payload.quoteAsset),
  buyTerms: payload.buyTerms
    ? {
        baseAmount: normalizeBigintString(payload.buyTerms.baseAmount) ?? '0',
        quoteAmount: normalizeBigintString(payload.buyTerms.quoteAmount) ?? '0'
      }
    : undefined,
  sellTerms: payload.sellTerms
    ? {
        baseAmount: normalizeBigintString(payload.sellTerms.baseAmount) ?? '0',
        quoteAmount: normalizeBigintString(payload.sellTerms.quoteAmount) ?? '0'
      }
    : undefined,
  initialBaseInventory: normalizeBigintString(payload.initialBaseInventory),
  initialQuoteInventory: normalizeBigintString(payload.initialQuoteInventory),
  expiresAt: Number.isFinite(payload.expiresAt) ? Math.max(0, Math.floor(Number(payload.expiresAt))) : undefined,
  parentEscrowContract: payload.parentEscrowContract?.trim() || undefined,
  parentTradeId:
    Number.isSafeInteger(payload.parentTradeId) && Number(payload.parentTradeId) > 0
      ? Number(payload.parentTradeId)
      : undefined
});

export const encodeTradeRecoveryPayload = (payload: TradeRecoveryPayload): string =>
  JSON.stringify({
    version: payload.version,
    kind: payload.kind,
    accessSecret: payload.accessSecret,
    maker: payload.maker,
    taker: payload.taker,
    offer: payload.offer,
    request: payload.request,
    baseAsset: payload.baseAsset,
    quoteAsset: payload.quoteAsset,
    buyTerms: payload.buyTerms,
    sellTerms: payload.sellTerms,
    initialBaseInventory: payload.initialBaseInventory,
    initialQuoteInventory: payload.initialQuoteInventory,
    expiresAt: payload.expiresAt,
    parentEscrowContract: payload.parentEscrowContract,
    parentTradeId: payload.parentTradeId
  });

export const encryptTradeRecoveryPayload = async (
  payload: TradeRecoveryPayload,
  aesKey: string
): Promise<string> => {
  const key = await deriveRecoveryKey(aesKey, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: toArrayBuffer(iv) },
      key,
      toArrayBuffer(TEXT_ENCODER.encode(encodeTradeRecoveryPayload(payload)))
    )
  );
  const encryptedPayload = new Uint8Array(1 + iv.length + ciphertext.length);
  encryptedPayload[0] = ENCRYPTED_PAYLOAD_VERSION;
  encryptedPayload.set(iv, 1);
  encryptedPayload.set(ciphertext, 1 + iv.length);
  return bytesToHex(encryptedPayload);
};

export const decryptTradeRecoveryPayload = async (
  encryptedPayload: string,
  aesKey: string
): Promise<TradeRecoveryPayload> => {
  const payload = hexToBytes(encryptedPayload);
  if (payload.length <= 1 + IV_BYTES || payload[0] !== ENCRYPTED_PAYLOAD_VERSION) {
    throw new Error('Invalid encrypted trade recovery payload.');
  }
  const key = await deriveRecoveryKey(aesKey, ['decrypt']);
  const iv = payload.slice(1, 1 + IV_BYTES);
  const ciphertext = payload.slice(1 + IV_BYTES);
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: toArrayBuffer(iv) }, key, toArrayBuffer(ciphertext));
  const parsed = JSON.parse(TEXT_DECODER.decode(decrypted)) as TradeRecoveryPayload;
  return buildTradeRecoveryPayload(parsed);
};

export const encryptTradeRecoveryPayloadForSigner = async (
  signer: RecoverySigner,
  payload: TradeRecoveryPayload
): Promise<string> => encryptTradeRecoveryPayload(payload, readSignerAesKey(signer));

export const decryptTradeRecoveryPayloadForSigner = async (
  signer: RecoverySigner,
  encryptedPayload: string
): Promise<TradeRecoveryPayload> => decryptTradeRecoveryPayload(encryptedPayload, readSignerAesKey(signer));

export const applyTradeRecoveryPayloadToSnapshot = <
  T extends { offer: TradeAssetPayload; request: TradeAssetPayload; hiddenLiquidity?: boolean }
>(
  snapshot: T,
  payload: TradeRecoveryPayload
): T => ({
  ...snapshot,
  offer: payload.offer ? { ...snapshot.offer, amount: payload.offer.amount } : snapshot.offer,
  request: payload.request ? { ...snapshot.request, amount: payload.request.amount } : snapshot.request,
  hiddenLiquidity: payload.kind === 'party' ? false : snapshot.hiddenLiquidity
});
