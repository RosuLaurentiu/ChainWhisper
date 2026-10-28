import { AbiCoder, getAddress, getBytes, keccak256, ZeroAddress } from '@coti-io/coti-ethers';
import { bytesToHex, hexToBytes, TEXT_DECODER, TEXT_ENCODER, toArrayBuffer } from './byteEncoding';

export type LinkTradeV2Context = Readonly<{
  chainId: string; escrow: string; maker: string; makerNonce: string; credentialEpoch: string;
}>;
export type LinkTradeV2Reference = Readonly<{
  chainId: string; escrow: string; id: string; revision: string; credentialEpoch: string;
}>;
export type LinkTradeV2Terms = Readonly<{
  offerToken: string; requestToken: string; privatePair: boolean;
  priceOffer: string; priceRequest: string; expiresAt: string;
}>;

const VERSION = 1, IV_BYTES = 12, MAX_PAYLOAD = 2048;
const invalid = (): never => { throw new Error('Invalid Link V2 terms or reference.'); };
const uint = (value: string, bits: number, zero = false): string => {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]*)$/.test(value) || value.length > 78) invalid();
  const number = BigInt(value);
  if ((!zero && number === 0n) || number >= (1n << BigInt(bits))) invalid();
  return value;
};
const address = (value: string): string => {
  if (typeof value !== 'string') invalid();
  const normalized = getAddress(value);
  if (normalized === ZeroAddress) invalid();
  return normalized.toLowerCase();
};
const fields = (value: object, names: readonly string[]) => {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).length !== names.length || names.some(name => !Object.prototype.hasOwnProperty.call(value, name))) invalid();
};

export const normalizeLinkTradeV2Reference = (ref: LinkTradeV2Reference): LinkTradeV2Reference => {
  fields(ref, ['chainId', 'escrow', 'id', 'revision', 'credentialEpoch']);
  return Object.freeze({ chainId: uint(ref.chainId, 256), escrow: address(ref.escrow),
    id: uint(ref.id, 256), revision: uint(ref.revision, 64), credentialEpoch: uint(ref.credentialEpoch, 64) });
};

/** Matches getOrderView().credentialDomain; this is not deployment attestation. */
export const linkTradeV2CredentialDomain = (context: LinkTradeV2Context): string => {
  fields(context, ['chainId', 'escrow', 'maker', 'makerNonce', 'credentialEpoch']);
  if (typeof context.makerNonce !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(context.makerNonce) ||
      BigInt(context.makerNonce) === 0n) invalid();
  return keccak256(AbiCoder.defaultAbiCoder().encode(
    ['string', 'uint256', 'address', 'address', 'bytes32', 'uint64'],
    ['CHAINWHISPER_LINK_OTC_V2', uint(context.chainId, 256), address(context.escrow),
      address(context.maker), context.makerNonce, uint(context.credentialEpoch, 64)]
  ));
};

export const normalizeLinkTradeV2Terms = (input: LinkTradeV2Terms): LinkTradeV2Terms => {
  fields(input, ['offerToken', 'requestToken', 'privatePair', 'priceOffer', 'priceRequest', 'expiresAt']);
  const offerToken = address(input.offerToken), requestToken = address(input.requestToken);
  if (offerToken === requestToken || typeof input.privatePair !== 'boolean') invalid();
  return Object.freeze({ offerToken, requestToken, privatePair: input.privatePair,
    priceOffer: uint(input.priceOffer, 128), priceRequest: uint(input.priceRequest, 128),
    expiresAt: uint(input.expiresAt, 64, true) });
};

const material = async (domain: string, secret: string, purpose: 'terms' | 'credential') => {
  if (typeof secret !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(secret) || BigInt(secret) === 0n) invalid();
  const key = await crypto.subtle.importKey('raw', toArrayBuffer(hexToBytes(secret)), 'HKDF', false, ['deriveBits']);
  return crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256',
    salt: toArrayBuffer(getBytes(domain)),
    info: toArrayBuffer(TEXT_ENCODER.encode(`ChainWhisperLinkOTCV2/${purpose}`)) }, key, 256);
};

/** Keep this value in memory; submit only its fresh wallet-encrypted COTI input. */
export const deriveLinkTradeV2Credential = async (context: LinkTradeV2Context, secret: string): Promise<bigint> => {
  const value = BigInt(bytesToHex(new Uint8Array(await material(linkTradeV2CredentialDomain(context), secret, 'credential')), '0x'));
  if (value === 0n) invalid();
  return value;
};

export const sealLinkTradeV2Terms = async (
  context: LinkTradeV2Context, input: LinkTradeV2Terms, secret: string
): Promise<string> => {
  const domain = linkTradeV2CredentialDomain(context), plaintext = TEXT_ENCODER.encode(JSON.stringify(normalizeLinkTradeV2Terms(input)));
  const key = await crypto.subtle.importKey('raw', await material(domain, secret, 'terms'), 'AES-GCM', false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM',
    iv: toArrayBuffer(iv), additionalData: toArrayBuffer(getBytes(domain)) },
  key, toArrayBuffer(plaintext)));
  const payload = new Uint8Array(1 + IV_BYTES + ciphertext.length);
  if (payload.length > MAX_PAYLOAD) invalid();
  payload[0] = VERSION;
  payload.set(iv, 1);
  payload.set(ciphertext, 1 + IV_BYTES);
  return bytesToHex(payload, '0x');
};

/** Read the envelope/context from the same attested order; settlement must verify its current reference and price. */
export const openLinkTradeV2Terms = async (
  context: LinkTradeV2Context, sealed: string, secret: string
): Promise<LinkTradeV2Terms> => {
  if (typeof sealed !== 'string' || sealed.length > 2 + MAX_PAYLOAD * 2 ||
      !/^0x(?:[0-9a-fA-F]{2})+$/.test(sealed)) invalid();
  const payload = hexToBytes(sealed);
  if (payload.length <= 1 + IV_BYTES + 16 || payload[0] !== VERSION) invalid();
  const domain = linkTradeV2CredentialDomain(context);
  const key = await crypto.subtle.importKey('raw', await material(domain, secret, 'terms'), 'AES-GCM', false, ['decrypt']);
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM',
    iv: toArrayBuffer(payload.slice(1, 1 + IV_BYTES)),
    additionalData: toArrayBuffer(getBytes(domain)) },
  key, toArrayBuffer(payload.slice(1 + IV_BYTES)));
  return normalizeLinkTradeV2Terms(JSON.parse(TEXT_DECODER.decode(plaintext)) as LinkTradeV2Terms);
};
