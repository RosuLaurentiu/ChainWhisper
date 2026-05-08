import type { TradeAssetPayload } from './appShared';
import { normalizeAccessHash } from './tradeLinks';

const TERMS_PAYLOAD_VERSION = 1;
const ENCRYPTED_PAYLOAD_VERSION = 1;
const IV_BYTES = 12;
const SECRET_BYTES = 32;
const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder();

export type PartyTradeTermsAsset = Pick<TradeAssetPayload, 'kind' | 'tokenAddress' | 'amount'>;

export type PartyTradeTerms = {
  version: 1;
  maker: string;
  taker: string;
  offer: PartyTradeTermsAsset;
  request: PartyTradeTermsAsset;
  expiresAt: number;
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
    throw new Error('Invalid encrypted trade terms payload.');
  }
  const bytes = new Uint8Array(normalized.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(normalized.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
};

export const createTradeAccessSecret = (): string => {
  const bytes = new Uint8Array(SECRET_BYTES);
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
};

const parseAccessSecret = (accessSecret: string): Uint8Array => {
  const normalized = normalizeAccessHash(accessSecret);
  if (!normalized) {
    throw new Error('A valid private trade link secret is required.');
  }
  return hexToBytes(normalized);
};

const deriveTermsKey = async (accessSecret: string, usages: KeyUsage[]): Promise<CryptoKey> => {
  const material = await crypto.subtle.importKey('raw', toArrayBuffer(parseAccessSecret(accessSecret)), 'HKDF', false, [
    'deriveKey'
  ]);
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: toArrayBuffer(TEXT_ENCODER.encode('ChainWhisperPartyTermsV1')),
      info: toArrayBuffer(TEXT_ENCODER.encode('party-trade-terms'))
    },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    usages
  );
};

const canonicalAsset = (asset: PartyTradeTermsAsset): PartyTradeTermsAsset => ({
  kind: asset.kind,
  tokenAddress: asset.tokenAddress?.trim() || undefined,
  amount: BigInt(asset.amount).toString()
});

export const buildPartyTradeTerms = (terms: Omit<PartyTradeTerms, 'version'>): PartyTradeTerms => ({
  version: TERMS_PAYLOAD_VERSION,
  maker: terms.maker,
  taker: terms.taker,
  offer: canonicalAsset(terms.offer),
  request: canonicalAsset(terms.request),
  expiresAt: Math.max(0, Math.floor(terms.expiresAt)),
  parentEscrowContract: terms.parentEscrowContract?.trim() || undefined,
  parentTradeId:
    Number.isSafeInteger(terms.parentTradeId) && Number(terms.parentTradeId) > 0
      ? Number(terms.parentTradeId)
      : undefined
});

export const encodePartyTradeTerms = (terms: PartyTradeTerms): string =>
  JSON.stringify({
    version: terms.version,
    maker: terms.maker,
    taker: terms.taker,
    offer: terms.offer,
    request: terms.request,
    expiresAt: terms.expiresAt,
    parentEscrowContract: terms.parentEscrowContract,
    parentTradeId: terms.parentTradeId
  });

export const encryptPartyTradeTerms = async (terms: PartyTradeTerms, accessSecret: string): Promise<string> => {
  const key = await deriveTermsKey(accessSecret, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: toArrayBuffer(iv) },
      key,
      toArrayBuffer(TEXT_ENCODER.encode(encodePartyTradeTerms(terms)))
    )
  );
  const payload = new Uint8Array(1 + iv.length + ciphertext.length);
  payload[0] = ENCRYPTED_PAYLOAD_VERSION;
  payload.set(iv, 1);
  payload.set(ciphertext, 1 + iv.length);
  return bytesToHex(payload);
};

export const decryptPartyTradeTerms = async (encryptedPayload: string, accessSecret: string): Promise<PartyTradeTerms> => {
  const payload = hexToBytes(encryptedPayload);
  if (payload.length <= 1 + IV_BYTES || payload[0] !== ENCRYPTED_PAYLOAD_VERSION) {
    throw new Error('Invalid encrypted trade terms payload.');
  }
  const key = await deriveTermsKey(accessSecret, ['decrypt']);
  const iv = payload.slice(1, 1 + IV_BYTES);
  const ciphertext = payload.slice(1 + IV_BYTES);
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: toArrayBuffer(iv) }, key, toArrayBuffer(ciphertext));
  const parsed = JSON.parse(TEXT_DECODER.decode(decrypted)) as PartyTradeTerms;
  return buildPartyTradeTerms(parsed);
};

export const applyPartyTradeTermsToSnapshot = <T extends { offer: TradeAssetPayload; request: TradeAssetPayload; hiddenLiquidity?: boolean }>(
  snapshot: T,
  terms: PartyTradeTerms
): T => ({
  ...snapshot,
  offer: { ...snapshot.offer, amount: terms.offer.amount },
  request: { ...snapshot.request, amount: terms.request.amount },
  hiddenLiquidity: false
});
