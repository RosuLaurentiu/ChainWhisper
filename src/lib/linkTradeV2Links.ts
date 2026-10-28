import { decodeBase64UrlBytes, encodeBase64UrlBytes, TEXT_DECODER, TEXT_ENCODER } from './byteEncoding';
import { normalizeLinkTradeV2Reference, type LinkTradeV2Reference } from './linkTradeV2Terms';

const PREFIX = '/otc/order/link/lv2.';
const LINK_PATH = /^\/(?:otc\/order\/(?:link|l)|trades\/l|otcdesk\/terminal\/l)\/lv2\.(.*)$/;
const invalid = (): never => { throw new Error('This shared trade link is invalid. Open the full Share link.'); };
const credential = (secret: string): string => {
  if (!/^0x[0-9a-fA-F]{64}$/.test(secret) || BigInt(secret) === 0n) invalid();
  return secret.toLowerCase();
};
const publicPath = (reference: LinkTradeV2Reference): string =>
  PREFIX + encodeBase64UrlBytes(TEXT_ENCODER.encode(JSON.stringify(normalizeLinkTradeV2Reference(reference))));

export const buildLinkTradeV2Path = (reference: LinkTradeV2Reference, secret = ''): string =>
  publicPath(reference) + (secret ? `#secret=${credential(secret)}` : '');

/** Public identity is in the path; the bearer credential never enters a query parameter. */
export const parseLinkTradeV2Path = (value: string): Readonly<{
  reference: LinkTradeV2Reference; secret: string; publicPath: string;
}> | null => {
  const url = new URL(value, 'https://chainwhisper.invalid'), match = url.pathname.match(LINK_PATH);
  if (!match) return null;
  const code = match[1];
  if (url.search || code.length > 1024 || !/^[A-Za-z0-9_-]+$/.test(code)) invalid();
  let reference: LinkTradeV2Reference;
  try {
    reference = normalizeLinkTradeV2Reference(JSON.parse(TEXT_DECODER.decode(decodeBase64UrlBytes(code))));
  } catch { return invalid(); }
  const path = publicPath(reference);
  if (path.slice(PREFIX.length) !== code) invalid();
  if (url.hash && !/^#secret=0x[0-9a-fA-F]{64}$/.test(url.hash)) invalid();
  return Object.freeze({ reference, secret: url.hash ? credential(url.hash.slice(8)) : '', publicPath: path });
};

/** Stored recovery records must carry only this public reference, never its fragment. */
export const stripLinkTradeV2Secret = (path: string): string => {
  try { return parseLinkTradeV2Path(path)?.publicPath ?? path; }
  catch { return ''; }
};

export const linkTradeV2Fragment = (path: string): string => {
  const link = parseLinkTradeV2Path(path);
  return link?.secret ? `#secret=${link.secret}` : '';
};

export const restoreLinkTradeV2Fragment = (path: string, fragment: string): string => {
  const link = parseLinkTradeV2Path(path);
  if (!link || !fragment) return path;
  try { return buildLinkTradeV2Path(link.reference, parseLinkTradeV2Path(link.publicPath + fragment)?.secret); }
  catch { return link.publicPath; }
};
